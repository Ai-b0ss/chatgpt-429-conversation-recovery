from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
import json, time, threading, urllib.parse, hashlib, base64, os

PORT=int(os.environ.get("PORT","9342"))
lock=threading.Lock()
state={"calls":[],"counts":{}}

HTML="""<!doctype html><meta charset="utf-8"><title>guard integration</title><body>ready</body>"""

def bump(path, method):
    key=f"{method} {path}"
    with lock:
        state["counts"][key]=state["counts"].get(key,0)+1
        n=state["counts"][key]
        state["calls"].append({"t":time.time(),"method":method,"path":path,"n":n})
    return n

class H(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        return

    def sendb(self,status,body,headers=None,ctype="application/json"):
        data=body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type",ctype)
        self.send_header("Content-Length",str(len(data)))
        for k,v in (headers or {}).items():
            self.send_header(k,v)
        self.end_headers()
        self.wfile.write(data)
    def do_GET(self):
        parsed=urllib.parse.urlparse(self.path)
        path=parsed.path
        if path=="/ws" and self.headers.get("Upgrade","").lower()=="websocket":
            query=urllib.parse.parse_qs(parsed.query)
            conversation_id=query.get("conversation_id",["resume-404"])[0]
            try: delay_ms=max(0,min(2000,int(query.get("delay_ms",["0"])[0])))
            except Exception: delay_ms=0
            key=self.headers.get("Sec-WebSocket-Key","")
            accept=base64.b64encode(hashlib.sha1(
                (key+"258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode("ascii")
            ).digest()).decode("ascii")
            self.send_response(101)
            self.send_header("Upgrade","websocket")
            self.send_header("Connection","Upgrade")
            self.send_header("Sec-WebSocket-Accept",accept)
            self.end_headers()
            if delay_ms:
                time.sleep(delay_ms/1000)
            payload=json.dumps({
                "type":"message",
                "topic_id":"conversations",
                "payload":{
                    "type":"conversation-turn-complete",
                    "payload":{"conversation_id":conversation_id}
                }
            }).encode("utf-8")
            if len(payload)<126:
                frame=bytes([0x81,len(payload)])+payload
            else:
                frame=bytes([0x81,126])+len(payload).to_bytes(2,"big")+payload
            self.wfile.write(frame)
            self.wfile.flush()
            time.sleep(0.05)
            return
        if path=="/":
            bump(path,"GET")
            return self.sendb(200,HTML,ctype="text/html; charset=utf-8")
        if path=="/state":
            with lock: body=json.dumps(state)
            return self.sendb(200,body)
        if path=="/reset":
            with lock:
                state["calls"].clear()
                state["counts"].clear()
            return self.sendb(200,'{"ok":true}')
        if path=="/backend-api/models":
            bump(path,"GET")
            return self.sendb(429,'{"detail":"models limited"}')
        if path.startswith("/backend-api/conversation/") and path.endswith("/stream_status"):
            bump(path,"GET")
            return self.sendb(200,'{"status":"IS_STREAMING"}')
        if path.startswith("/backend-api/conversations/"):
            ident=path.rsplit("/",1)[-1]
            n=bump(path,"GET")
            if ident in ("concurrent","request-object","two-tabs","global-a"):
                if n==1:
                    return self.sendb(429,'{"detail":"Too many requests"}')
                return self.sendb(200,json.dumps({"ok":True,"id":ident,"n":n}))
            if ident=="global-b":
                return self.sendb(200,json.dumps({"ok":True,"id":ident,"n":n}))
            if ident=="always-429":
                return self.sendb(429,'{"detail":"Too many requests"}')
            if ident=="retry-after":
                if n==1:
                    return self.sendb(429,'{"detail":"Too many requests"}',{"Retry-After":"14"})
                return self.sendb(200,'{"ok":true}')
            if ident=="ui-budget":
                if n<=2:
                    return self.sendb(429,'{"detail":"Too many requests"}')
                return self.sendb(200,'{"ok":true}')
            if ident=="resume-detail-hydrate":
                time.sleep(2.0)
                return self.sendb(200,json.dumps({"ok":True,"id":ident,"n":n}))
            if ident=="resume-detail-fail":
                time.sleep(0.35)
                return self.sendb(500,'{"detail":"detail failed"}')
            return self.sendb(200,json.dumps({"ok":True,"id":ident,"n":n}))
        bump(path,"GET")
        return self.sendb(404,'{"error":"not found"}')
    def do_POST(self):
        parsed=urllib.parse.urlparse(self.path)
        path=parsed.path
        bump(path,"POST")
        if path=="/backend-api/f/conversation/resume":
            length=int(self.headers.get("Content-Length","0") or "0")
            raw=self.rfile.read(length).decode("utf-8") if length else "{}"
            try: body=json.loads(raw)
            except Exception: body={}
            ident=body.get("conversation_id")
            offset=body.get("offset")
            with lock:
                if state["calls"] and state["calls"][-1].get("path")==path:
                    state["calls"][-1]["conversation_id"]=ident
                    state["calls"][-1]["offset"]=offset
                    state["calls"][-1]["probe"]=body.get("probe")
                    state["calls"][-1]["resume_context"]=self.headers.get("X-Resume-Context")
            if ident=="resume-race":
                time.sleep(0.30)
                return self.sendb(404,'{"detail":"resume target missing"}')
            if ident in (
                "resume-404",
                "resume-ws",
                "resume-exhaust",
                "resume-abort",
                "resume-concurrent",
                "resume-cross-tab",
                "resume-stale-status"
            ):
                return self.sendb(404,'{"detail":"resume target missing"}')
            if ident=="resume-nonstream":
                if offset==0:
                    return self.sendb(404,'{"detail":"resume target missing"}')
                return self.sendb(200,'{"ok":true}')
            if ident=="resume-handoff":
                if offset==0:
                    return self.sendb(404,'{"detail":"resume target missing"}')
                stream=(
                    'event: resume_conversation_token\n'
                    'data: {"type":"resume_conversation_token","token":"lab-token","conversation_id":"resume-handoff"}\n\n'
                    'data: {"type":"stream_handoff","conversation_id":"resume-handoff","turn_exchange_id":"lab-turn",'
                    '"options":[{"type":"subscribe_ws_topic","topic_id":"conversation-turn-lab-turn"}]}\n\n'
                    'data: [DONE]\n\n'
                )
                return self.sendb(200,stream,ctype="text/event-stream")
            if ident in (
                "resume-recover",
                "resume-oldcomplete",
                "resume-detail-fail",
                "resume-detail-hydrate"
            ) and offset!=1:
                return self.sendb(404,'{"detail":"resume offset missing"}')
            if ident=="resume-absolute" and offset!=0:
                return self.sendb(404,'{"detail":"resume absolute offset missing"}')
            if ident in (
                "resume-success",
                "resume-recover",
                "resume-oldcomplete",
                "resume-absolute",
                "resume-detail-fail",
                "resume-detail-hydrate"
            ):
                stream=(
                    'data: {"p":"","o":"add","v":{"message":{"id":"a1","author":{"role":"assistant"},'
                    '"channel":"final","status":"in_progress","end_turn":false}}}\n\n'
                    'data: {"p":"/message/status","o":"replace","v":"finished_successfully"}\n\n'
                    'data: {"p":"/message/end_turn","o":"replace","v":true}\n\n'
                    'data: {"type":"message_stream_complete"}\n\n'
                    'data: [DONE]\n\n'
                )
                return self.sendb(200,stream,ctype="text/event-stream")
            return self.sendb(200,'data: [DONE]\n\n',ctype="text/event-stream")
        if path.startswith("/backend-api/conversations/"):
            return self.sendb(429,'{"detail":"post limited"}')
        return self.sendb(200,'{"ok":true}')

if __name__=="__main__":
    print(f"LISTENING {PORT}",flush=True)
    ThreadingHTTPServer(("127.0.0.1",PORT),H).serve_forever()
