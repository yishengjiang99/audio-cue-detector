# Audio Cue Detector

Browser-native advisory audio cue detection using Web Audio. It does not attach
to World of Warcraft, read game memory, send inputs, or redistribute audio.

## Run

Serve this folder on localhost:

```bash
node -e "const http=require('http'),fs=require('fs'),path=require('path');const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'};http.createServer((req,res)=>{const p=path.join(process.cwd(),req.url==='/'?'index.html':decodeURIComponent(req.url));fs.readFile(p,(e,d)=>{if(e){res.writeHead(404);res.end('not found');return}res.writeHead(200,{'content-type':types[path.extname(p)]||'application/octet-stream'});res.end(d)})}).listen(4173,'127.0.0.1',()=>console.log('http://127.0.0.1:4173'))"
```

Open:

```text
http://127.0.0.1:4173
```

Click `Enable Audio Context`, choose a browser-visible audio input, load cue
audio files, then start detection.

For game-output audio, the browser needs a loopback/system-audio input device.
macOS output-only devices such as `External Headphones` are not directly
capturable through Web Audio.

## Tuning

- Lower `Threshold` to catch quieter or less exact matches.
- Raise `Threshold` to reduce false positives.
- Lower `Min match` to reduce latency.
- Raise `Min match` for more stable matches.
