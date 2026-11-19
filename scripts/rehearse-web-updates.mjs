// Local-only release switcher for manual browser update acceptance. No production writes.
import http from 'node:http';
import {readFile,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url)),stage=path.join(root,'.deploy-assets');
const release=JSON.parse(await readFile(path.join(stage,'app-release.json'),'utf8')).version;
const old='0648297a8feec9fb74507b709dc6145b8173f5aa',allowed=new Set(await readdir(stage));
let phase='baseline';const navigations=[];
const content=name=>name.endsWith('.html')?'text/html':name.endsWith('.js')?'application/javascript':name.endsWith('.json')?'application/json':name.endsWith('.css')?'text/css':name.endsWith('.svg')?'image/svg+xml':name.endsWith('.png')?'image/png':'text/plain';
const server=http.createServer(async(req,res)=>{
    try {
        const url=new URL(req.url,'http://127.0.0.1:4186');
        if(url.pathname==='/_qa') {
            if(req.method==='POST') {
                if(req.headers.origin!=='http://127.0.0.1:4186'){res.writeHead(403);res.end();return;}
                let body='';for await(const part of req){body+=part;if(body.length>1000)throw new Error('too large');}
                const next=new URLSearchParams(body).get('phase');if(['baseline','candidate','next'].includes(next))phase=next;
                res.writeHead(303,{Location:'/_qa?changed='+Date.now()});res.end();return;
            }
            res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});
            res.end(`<!doctype html><title>Journey update rehearsal</title><h1>Local update rehearsal</h1><p id="phase">Serving ${phase}: ${phase==='baseline'?'20261115i':phase==='next'?'next-'+release:release}</p><form method="post"><button name="phase" value="candidate">Publish candidate</button><button name="phase" value="next">Publish next release fixture</button><button name="phase" value="baseline">Restore baseline</button></form><p><a href="/?widget=1#tube" target="_blank">Open test app</a></p><pre>${JSON.stringify(navigations.slice(-20),null,2)}</pre>`);return;
        }
        const name=url.pathname==='/'?'index.html':url.pathname.slice(1);
        if(!allowed.has(name)||name==='_headers'){res.writeHead(404);res.end();return;}
        let bytes;
        if(phase==='baseline') {
            try{bytes=execFileSync('git',['show',`${old}:${name}`],{cwd:root,maxBuffer:1000000,stdio:['ignore','pipe','ignore']});}
            catch{res.writeHead(404);res.end();return;}
        } else {
            bytes=await readFile(path.join(stage,name));
            if(phase==='next'&&/\.(html|js|json|css|svg)$/.test(name))bytes=Buffer.from(bytes.toString().replaceAll(release,'next-'+release));
        }
        if(name==='index.html'){navigations.push({at:new Date().toISOString(),phase,url:req.url});console.log(JSON.stringify(navigations.at(-1)));}
        res.writeHead(200,{'Content-Type':content(name),'Cache-Control':'no-store'});res.end(bytes);
    }catch{res.writeHead(500);res.end('Rehearsal server error');}
});
server.listen(4186,'127.0.0.1',()=>console.log(JSON.stringify({url:'http://127.0.0.1:4186/_qa',phase,release})));
