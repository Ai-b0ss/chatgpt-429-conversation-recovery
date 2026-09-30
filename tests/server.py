from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
import json, time, threading, urllib.parse, hashlib, base64

PORT=9342
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
            key=self.headers.get("Sec-WebSocket-Key","")
            accept=base64.b64encode(hashlib.sha1(
                (key+"258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode("ascii")
            ).digest()).decode("ascii")
            self.send_response(101)
            self.send_header("Upgrade","websocket")
            self.send_header("Connection","Upgrade")
            self.send_header("Sec-WebSocket-Accept",accept)
            self.end_headers()
            payload=json.dumps({
                "type":"message",
                "topic_id":"conversations",
                "payload":{
                    "type":"conversation-turn-complete",
                    "payload":{"conversation_id":"resume-404"}
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
            if ident=="resume-404":
                return self.sendb(404,'{"detail":"resume target missing"}')
            if ident=="resume-success":
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
