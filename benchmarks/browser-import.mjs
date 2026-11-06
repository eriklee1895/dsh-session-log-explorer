// Synthetic-data browser instrumentation; metrics include scheduling and rendering, not just CPU time.
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
if (!process.argv[2] || !process.argv[3] || !process.argv[4]) throw new Error('Usage: node benchmarks/browser-import.mjs INPUT DIST PLAYWRIGHT_MODULE [REPORT]')
const { chromium } = await import(pathToFileURL(resolve(process.argv[4])).href)
import { createExplorerServer } from '../scripts/serve.mjs'
import { writeFile } from 'node:fs/promises'
const server=await createExplorerServer({directory:resolve(process.argv[3])})
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox','--enable-precise-memory-info']})
const page=await browser.newPage({viewport:{width:1440,height:1000}})
await page.addInitScript(()=>{
 window.__perf={frames:[],gaps:[],longTasks:[],heap:[],sent:0,received:0,post:0,start:0,ready:0}
 const BaseWorker=window.Worker
 window.Worker=class extends BaseWorker{
  constructor(...args){super(...args);this.addEventListener('message',({data})=>{if(data.type==='ready'){window.__perf.received=performance.now();window.__perf.sent=data.__sentAt||0}})}
  postMessage(...args){if(args[0].type==='import'||args[0].type==='import-files'){window.__perf.start ||= performance.now();const t=performance.now();const r=super.postMessage(...args);window.__perf.post=performance.now()-t;return r}return super.postMessage(...args)}
 }
 document.addEventListener('change',event=>{if(event.target instanceof HTMLInputElement&&event.target.type==='file')window.__perf.start=performance.now()},true)
 let previousFrame=performance.now();const frame=t=>{if(window.__perf.start)window.__perf.frames.push(t-previousFrame);previousFrame=t;requestAnimationFrame(frame)};requestAnimationFrame(frame)
 let last=performance.now()
 setInterval(()=>{const t=performance.now();if(window.__perf.start){window.__perf.gaps.push(t-last);window.__perf.heap.push(performance.memory?.usedJSHeapSize||0)}last=t},16)
 new PerformanceObserver(list=>{window.__perf.longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))}).observe({type:'longtask',buffered:true})
 new MutationObserver(()=>{if(document.querySelector('.session-tree')&&!document.querySelector('[role=dialog]'))window.__perf.ready||=performance.now()}).observe(document,{subtree:true,childList:true,attributes:true})
})
await page.route('**/assets/session.worker-*.js',async route=>{
 const response=await route.fetch();const text=await response.text()
 await route.fulfill({response,body:'const __post=self.postMessage.bind(self);self.postMessage=(data,...rest)=>__post({...data,__sentAt:performance.timeOrigin+performance.now()},...rest);\n'+text})
})
try{
 await page.goto(server.url)
 await page.locator('input[type=file]').first().setInputFiles(resolve(process.argv[2]))
 await page.waitForFunction(()=>window.__perf.ready>0,{},{timeout:120000})
 await page.waitForTimeout(500)
 const data=await page.evaluate(()=>{const p=window.__perf;const sorted=p.gaps.slice().sort((a,b)=>a-b);return{elapsedMs:p.ready-p.start,postMessageMs:p.post,workerToMainMs:p.sent?performance.timeOrigin+p.received-p.sent:null,readyToDomMs:p.ready-p.received,maxFrameGapMs:Math.max(0,...p.frames),maxHeartbeatGapMs:Math.max(0,...p.gaps),p95HeartbeatGapMs:sorted[Math.floor(sorted.length*.95)],longTasks:p.longTasks.filter(e=>e.start>=p.start),peakObservedHeapBytes:Math.max(0,...p.heap),finalHeapBytes:performance.memory?.usedJSHeapSize,domNodes:document.querySelectorAll('*').length}})
 if (process.argv[5]) await writeFile(resolve(process.argv[5]),JSON.stringify(data,null,2))
 console.log(JSON.stringify(data))
}finally{await browser.close();await server.close()}
