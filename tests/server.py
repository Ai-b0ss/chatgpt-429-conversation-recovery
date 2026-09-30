from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
import json, time, threading, urllib.parse

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
        if path.startswith("/backend-api/conversations/"):
            ident=path.rsplit("/",1)[-1]
            n=bump(path,"GET")
            if ident in ("concurrent","request-object","two-tabs"):
                if n==1:
                    return self.sendb(429,'{"detail":"Too many requests"}')
                return self.sendb(200,json.dumps({"ok":True,"id":ident,"n":n}))
            if ident=="always-429":
                return self.sendb(429,'{"detail":"Too many requests"}')
            if ident=="retry-after":
                if n==1:
                    return self.sendb(429,'{"detail":"Too many requests"}',{"Retry-After":"1"})
                return self.sendb(200,'{"ok":true}')
            return self.sendb(200,json.dumps({"ok":True,"id":ident,"n":n}))
        bump(path,"GET")
        return self.sendb(404,'{"error":"not found"}')
    def do_POST(self):
        parsed=urllib.parse.urlparse(self.path)
        path=parsed.path
        bump(path,"POST")
        if path.startswith("/backend-api/conversations/"):
            return self.sendb(429,'{"detail":"post limited"}')
        return self.sendb(200,'{"ok":true}')

if __name__=="__main__":
    print(f"LISTENING {PORT}",flush=True)
    ThreadingHTTPServer(("127.0.0.1",PORT),H).serve_forever()
