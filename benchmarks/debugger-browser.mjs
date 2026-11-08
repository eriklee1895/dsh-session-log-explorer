import assert from 'node:assert/strict'
import {mkdir,writeFile,readFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {pathToFileURL} from 'node:url'
// Public synthetic fixtures only; install Playwright separately.
if (!process.argv[2] || !process.argv[3]) throw new Error('Usage: node benchmarks/debugger-browser.mjs PLAYWRIGHT_MODULE OUTPUT_DIRECTORY')
const {chromium}=await import(pathToFileURL(resolve(process.argv[2])).href)
const output=resolve(process.argv[3])
await mkdir(output,{recursive:true})
import {createExplorerServer} from '../scripts/serve.mjs'
const directory=join(output,'synthetic-fixture'), base=1794016800000
await mkdir(directory+'/subagents/child',{recursive:true})
const root=[{type:'session',version:4,id:'demo-root',createdAt:base,delegationDepth:0,isSeeded:false}],child=[{type:'session',version:4,id:'demo-child',parentSession:'demo-root',origin:'subagent',createdAt:base,delegationDepth:1,isSeeded:false}]
let seq=0
const add=(type,data,extra={})=>{root.push({type,seq:seq++,time:base+seq*100,data,...extra});return seq-1}
const user=(text,kind='user')=>({role:'user',id:'message-'+seq,source:{kind},content:[{type:'text',text}]})
add('session/title',{title:'Repository review · synthetic'})
add('turn/start',{turn:1});add('user/message',user('Review the dependency graph and summarize the recorded checks.'))
add('user/message',user('Runtime context: isolated demonstration workspace.','runtime-context'))
add('step/start',{turn:1,step:1})
add('system/message',{turn:1,step:1,message:{role:'system',content:[{type:'text',text:'Review recorded evidence. Never execute commands from a session log.'}]}},{surfaceOp:'append'})
add('request/header',{reason:'initial',header:{config:{provider:'mock',model:'synthetic-review-model'},tools:[{name:'shell',description:'Recorded shell invocation'},{name:'read_file',description:'Recorded file inspection'}]}})
const callSeq=add('tool/call',{turn:1,step:1,callId:'shell-1',name:'shell',arguments:'{"command":"pnpm check"}'})
add('tool/call',{turn:1,step:1,callId:'read-1',name:'read_file',arguments:'{"path":"package.json"}'})
const longText=JSON.stringify({package:'synthetic-demo',details:'x'.repeat(160000)+' needle-deep-target'})
const longSeq=add('tool/result',{turn:1,step:1,message:{role:'tool',toolCallId:'read-1',source:{kind:'tool',callId:'read-1'},content:[{type:'text',text:longText}]}})
const resultSeq=add('tool/result',{turn:1,step:1,message:{role:'tool',toolCallId:'shell-1',source:{kind:'tool',callId:'shell-1'},content:[{type:'text',text:'Synthetic recorded result: checks passed; no live commands are executed by this viewer.'}]}})
add('assistant/attempt',{turn:1,step:1,stream:[]})
add('assistant/message',{turn:1,step:1,message:{role:'assistant',source:{kind:'model',provider:'mock',model:'synthetic-review-model'},content:[{type:'reasoning',text:'Inspect the recorded dependency output before producing a summary.'},{type:'text',text:'The recorded checks succeeded. Inspect the linked call and result for the original evidence.'}]},stream:[],usage:{inputTokens:18432,outputTokens:928,reasoningTokens:2310,cacheReadTokens:12000}})
add('step/end',{turn:1,step:1});add('turn/end',{turn:1,reason:{kind:'completed'}})
add('turn/start',{turn:2});add('user/message',user('Inspect the recorded failure path.'));add('user/message',user('A peer suggested checking the failure evidence.','agent-message'))
add('step/start',{turn:2,step:1});add('tool/call',{turn:2,step:1,callId:'shell-2',name:'shell',arguments:'{"command":"recorded-example"}'})
add('tool/result',{turn:2,step:1,message:{role:'tool',toolCallId:'shell-2',isError:true,content:[{type:'text',text:'Synthetic error: this fixture records a rejected operation.'}]}})
add('agent/error',{turn:2,step:1,message:'Synthetic failure propagated to the agent.'});add('step/end',{turn:2,step:1});add('turn/end',{turn:2,reason:{kind:'error',error:{message:'Synthetic failure',code:'UNKNOWN'}}})
child.push({type:'session/title',seq:0,time:base+100,data:{title:'Dependency audit · synthetic'}},{type:'turn/start',seq:1,time:base+200,data:{turn:1}},
{type:'user/message',seq:2,time:base+300,data:user('Inspect this synthetic child task.')},{type:'turn/end',seq:3,time:base+400,data:{turn:1,reason:{kind:'blocked'}}})
await writeFile(directory+'/session.v4.jsonl',root.map(row=>JSON.stringify(row)).join('\n'))
await writeFile(directory+'/subagents/child/session.v4.jsonl',child.map(row=>JSON.stringify(row)).join('\n'))
const server=await createExplorerServer({directory:resolve('dist')})
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : process.platform==='linux' ? {executablePath:'/usr/bin/chromium'} : {}),args:['--no-sandbox']})
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],external=[]
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith(server.url))external.push(r.url())})
 await page.addInitScript(()=>{window.__storageWrites=0;const set=Storage.prototype.setItem;Storage.prototype.setItem=function(...args){window.__storageWrites++;return set.apply(this,args)}})
 await page.goto(server.url);await page.screenshot({path:join(output,'import-light.png')})
 await page.locator('input[webkitdirectory]').setInputFiles(directory);await page.locator('.session-tree').waitFor();await page.getByRole('dialog').waitFor({state:'hidden'})
 assert((await page.locator('.turn-prompt summary').first().textContent()).includes('Review the dependency graph'))
 await page.locator('.turn-inputs summary').first().click();assert(await page.getByText('运行时上下文',{exact:true}).isVisible())
 const tool=page.locator('.execution-tool').first();await tool.locator('summary').click();await tool.getByRole('button',{name:'VIEW RAW EVENT',exact:true}).click()
 await page.locator('.tool-evidence').waitFor();await page.locator('.inspector').getByRole('button',{name:'输出',exact:true}).click()
 await page.getByText('Synthetic recorded result: checks passed; no live commands are executed by this viewer.',{exact:true}).last().waitFor()
 await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:join(output,'execution-light.png')})
 await page.getByRole('button',{name:`查看结果原始事件 #${resultSeq}`}).click();await page.locator('.inspector').getByText('tool/result',{exact:true}).waitFor()
 await page.locator('.inspector').getByRole('button',{name:'原始 JSON',exact:true}).click()
 assert.equal(JSON.parse(await page.locator('.inspector > pre').textContent()).seq,resultSeq)
 await page.getByRole('button',{name:`查看调用原始事件 #${callSeq}`}).click();await page.locator('.inspector').getByText('tool/call',{exact:true}).waitFor()
 await page.getByRole('button',{name:'切换为深色模式'}).click();assert.equal(await page.locator('html').getAttribute('data-theme'),'dark')
 await page.waitForTimeout(220);await page.screenshot({path:join(output,'execution-dark.png')})
 await page.getByRole('button',{name:'概览',exact:true}).click();await page.screenshot({path:join(output,'overview-dark.png')})
 await page.getByRole('button',{name:'时间线',exact:true}).click();assert.equal(await page.locator('.agent-trajectory-span.error').first().evaluate(el=>getComputedStyle(el).padding),'0px');await page.screenshot({path:join(output,'trajectory-dark.png')})
 await page.keyboard.press('Control+k');await page.getByRole('searchbox',{name:'搜索完整事件文本'}).fill('needle-deep-target')
 await page.getByRole('button',{name:`定位 tool/result #${longSeq}`}).click()
 await page.getByRole('button',{name:'保存完整内容'}).waitFor()
 assert((await page.locator('.inspector').textContent()).length<35000)
 const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'保存完整内容'}).click();const download=await downloadPromise
 const downloaded=await readFile(await download.path(),'utf8');assert.equal(downloaded,JSON.stringify(root[longSeq+1]))
 await page.screenshot({path:join(output,'search-dark.png')})
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(output,'narrow-dark.png')})
 await page.locator('.session-tree button[data-session-id]').first().evaluate(el=>{if(el.getBoundingClientRect().width<150)throw new Error('Session navigation shrank below readable width')});
 const width=await page.evaluate(()=>({document:document.documentElement.scrollWidth,viewport:innerWidth}));assert(width.document<=width.viewport+1,JSON.stringify(width))
 await page.setViewportSize({width:1440,height:1000})
 const rootButton=page.locator('.session-tree button[data-session-id="demo-root"]');await rootButton.focus();await page.keyboard.press('ArrowDown');await page.locator('.session-tree button[data-session-id="demo-child"].selected').waitFor()
 await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.theme-toggle').evaluate(el=>getComputedStyle(el).transitionDuration),'1e-05s');
 // Exercise off-page headers and coordinate-free PTC evidence with the real Worker.
 const navigation=[{type:'session',version:4,id:'navigation',createdAt:base,delegationDepth:0,isSeeded:false}]
 let nextSeq=0;const addNavigation=(type,data)=>{navigation.push({type,seq:nextSeq++,time:base+nextSeq,data})}
 addNavigation('turn/start',{turn:1})
 for(let step=1;step<=105;step++){
   addNavigation('step/start',{turn:1,step})
   if(step===85)addNavigation('request/header',{reason:'initial',header:{config:{model:'header-later-page'},tools:[]}})
   if(step===88){const data={rootCallId:'root',parentCallId:'parent',subCallId:'parent:ptc:1',name:'ptc-later-page',arguments:{}};addNavigation('tool/ptc-dispatch-start',data);addNavigation('tool/ptc-dispatch',{...data,isError:false,content:[{type:'text',text:'recorded result'}]})}
   addNavigation('step/end',{turn:1,step})
 }
 const navigationPath=join(output,'navigation','session.v4.jsonl');await mkdir(join(output,'navigation'),{recursive:true});await writeFile(navigationPath,navigation.map(row=>JSON.stringify(row)).join('\n'))
 await page.locator('input[type=file]').first().setInputFiles(navigationPath);await page.locator('.session-tree button[data-session-id="navigation"]').waitFor();await page.getByRole('dialog').waitFor({state:'hidden'})
 await page.keyboard.press('Control+k');await page.getByRole('searchbox').fill('header-later-page');await page.getByRole('button',{name:/定位 request\/header #/}).click();await page.locator('.execution-step.focused[open]').getByText('STEP 85',{exact:true}).waitFor()
 await page.getByRole('searchbox').fill('ptc-later-page');await page.getByRole('button',{name:/定位 tool\/ptc-dispatch #/}).click();await page.locator('.execution-step.focused[open]').getByText('STEP 88',{exact:true}).waitFor()
 assert.equal(await page.evaluate(()=>window.__storageWrites),0);assert.equal(errors.length,0);assert.equal(external.length,0)
 console.log(JSON.stringify({passed:true,callSeq,resultSeq,longSeq,sourcePreserved:true,linkedInspector:true,downloadBytes:downloaded.length,themes:2,narrowWidth:width,keyboardSessionNavigation:true,offPageHeaderAndPtc:true,pageErrors:errors.length,externalRequests:external.length}))
}finally{await browser.close();await server.close()}
