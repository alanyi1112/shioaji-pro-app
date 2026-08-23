import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const root = resolve(import.meta.dirname, "..");
const evidencePath = resolve(root, "../../openspec/changes/align-minute-k-day-boundaries-and-taiwan-volume-parity/evidence/multiview-day-boundary-8-panel.png");

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#0f172a;color:#e2e8f0;font:12px system-ui}#grid{display:grid;gap:8px;padding:8px}.panel{height:250px;border:1px solid #334155;background:#18212f;overflow:hidden}.label{height:20px;padding:3px 7px;box-sizing:border-box}.main{height:145px}.indicator{height:80px;border-top:1px solid #334155}
</style></head><body><div id="grid"></div>
<script src="/vendor/lightweight-charts.standalone.production.js"></script>
<script src="/static/day-boundary-primitive.js"></script>
<script>
const rows = [
  ['2026-08-20T13:28:00+08:00',100,101,99,100,2],
  ['2026-08-20T13:29:00+08:00',100,102,99,101,3],
  ['2026-08-21T09:00:00+08:00',102,104,101,103,4],
  ['2026-08-21T09:01:00+08:00',103,105,102,104,5],
].map(([iso,open,high,low,close,volume])=>({time:Date.parse(iso)/1000,open,high,low,close,volume}));
let panels=[]; let attachCount=0; let detachCount=0;
function colors(c){return c.close>=c.open?'rgba(220,38,38,.72)':'rgba(22,163,74,.72)'}
function observed(series){const a=series.attachPrimitive.bind(series),d=series.detachPrimitive.bind(series);series.attachPrimitive=(p)=>{attachCount++;return a(p)};series.detachPrimitive=(p)=>{detachCount++;return d(p)};return series}
function dispose(){for(const p of panels){p.manager.destroy();p.indicator.remove();p.main.remove();p.element.remove()}panels=[]}
function makePanel(index,interval){
 const element=document.createElement('section');element.className='panel';element.innerHTML='<div class="label">Panel '+(index+1)+' · '+interval+' · 主圖＋成交量＋技術副圖</div><div class="main"></div><div class="indicator"></div>';document.querySelector('#grid').append(element);
 const main=LightweightCharts.createChart(element.querySelector('.main'),{width:element.clientWidth,height:145,layout:{background:{type:'solid',color:'#18212f'},textColor:'#cbd5e1',attributionLogo:false},grid:{vertLines:{color:'rgba(148,163,184,.13)'},horzLines:{color:'rgba(148,163,184,.13)'}},timeScale:{timeVisible:true}});
 const candle=observed(main.addSeries(LightweightCharts.CandlestickSeries,{upColor:'#dc2626',downColor:'#16a34a',borderVisible:false,wickUpColor:'#dc2626',wickDownColor:'#16a34a'}));candle.setData(rows);
 const volume=main.addSeries(LightweightCharts.HistogramSeries,{priceScaleId:'',priceFormat:{type:'volume'}});volume.priceScale().applyOptions({scaleMargins:{top:.72,bottom:0}});volume.setData(rows.map(c=>({time:c.time,value:c.volume,color:colors(c)})));
 const indicator=LightweightCharts.createChart(element.querySelector('.indicator'),{width:element.clientWidth,height:80,layout:{background:{type:'solid',color:'#111827'},textColor:'#94a3b8',attributionLogo:false},grid:{vertLines:{color:'rgba(148,163,184,.08)'},horzLines:{color:'rgba(148,163,184,.08)'}},timeScale:{visible:false}});
 const anchor=observed(indicator.addSeries(LightweightCharts.LineSeries,{color:'rgba(0,0,0,0)',priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false}));anchor.setData(rows.map(c=>({time:c.time,value:0})));
 const rsi=indicator.addSeries(LightweightCharts.LineSeries,{color:'#38bdf8',priceLineVisible:false,lastValueVisible:false});rsi.setData(rows.map((c,i)=>({time:c.time,value:45+i*5})));
 const manager=new QuoteChartDayBoundaries.DayBoundarySeriesManager();manager.reconcile([candle,anchor],QuoteChartDayBoundaries.selectDayBoundaries(rows,interval));main.timeScale().fitContent();indicator.timeScale().fitContent();
 return {element,main,indicator,candle,anchor,manager,interval};
}
function yellowPixels(){let count=0;for(const canvas of document.querySelectorAll('canvas')){const ctx=canvas.getContext('2d');if(!ctx)continue;const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;for(let i=0;i<data.length;i+=4){const r=data[i],g=data[i+1],b=data[i+2];if(r>=80&&g>=70&&b<=70&&r>g&&g>b*1.5&&data[i+3]>0)count++}}return count}
window.runHarness=async(count,interval)=>{dispose();attachCount=0;detachCount=0;const grid=document.querySelector('#grid');grid.style.gridTemplateColumns=count===1?'1fr':count<=4?'repeat(2,1fr)':'repeat(4,1fr)';panels=Array.from({length:count},(_,i)=>makePanel(i,interval));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return {panels:panels.length,attachments:attachCount,yellowPixels:yellowPixels(),managerSizes:panels.map(p=>p.manager.size)}};
window.sameDayGap=async()=>{const same=[rows[0],rows[1]];for(const p of panels)p.manager.update(QuoteChartDayBoundaries.selectDayBoundaries(same,p.interval));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return yellowPixels()};
window.restoreAndExercise=async(interval)=>{for(const p of panels){p.interval=interval;p.manager.update(QuoteChartDayBoundaries.selectDayBoundaries(rows,interval));p.main.resize(Math.max(240,p.element.clientWidth-2),145);p.indicator.resize(Math.max(240,p.element.clientWidth-2),80);p.main.timeScale().scrollToPosition(-.5,false);p.indicator.timeScale().scrollToPosition(-.5,false)}await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return yellowPixels()};
window.disposeHarness=()=>{const active=panels.reduce((n,p)=>n+p.manager.size,0);dispose();return {active,detachCount,remaining:document.querySelectorAll('.panel').length}};
</script></body></html>`;

const server = createServer(async (request, response) => {
  try {
    if (request.url === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(html);
      return;
    }
    if (request.url === "/favicon.ico") {
      response.writeHead(204).end();
      return;
    }
    const file = request.url === "/vendor/lightweight-charts.standalone.production.js"
      ? resolve(root, "public/vendor/lightweight-charts.standalone.production.js")
      : request.url === "/static/day-boundary-primitive.js"
        ? resolve(root, "public/static/day-boundary-primitive.js")
        : null;
    if (!file) {
      response.writeHead(404).end("not found");
      return;
    }
    response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
    response.end(await readFile(file));
  } catch (error) {
    response.writeHead(500).end(String(error));
  }
});

await new Promise((resolveListen, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolveListen);
});
const address = server.address();
const origin = `http://127.0.0.1:${address.port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin, { waitUntil: "load" });
  for (const count of [1, 2, 4, 8]) {
    for (const interval of ["1m", "5m", "15m", "1h"]) {
      const result = await page.evaluate(([nextCount, nextInterval]) => window.runHarness(nextCount, nextInterval), [count, interval]);
      if (result.panels !== count || result.attachments !== count * 2 || result.managerSizes.some((size) => size !== 2) || result.yellowPixels < count * 20) throw new Error(`day_boundary_visible_failed:${count}:${interval}:${JSON.stringify(result)}`);
    }
  }
  const noBoundaryPixels = await page.evaluate(() => window.sameDayGap());
  if (noBoundaryPixels !== 0) throw new Error(`same_day_gap_rendered_boundary:${noBoundaryPixels}`);
  const restoredPixels = await page.evaluate(() => window.restoreAndExercise("1m"));
  if (restoredPixels < 160) throw new Error(`resize_zoom_boundary_missing:${restoredPixels}`);
  await mkdir(resolve(evidencePath, ".."), { recursive: true });
  await page.locator("#grid").screenshot({ path: evidencePath });
  const cleanup = await page.evaluate(() => window.disposeHarness());
  if (cleanup.active !== 16 || cleanup.detachCount < 16 || cleanup.remaining !== 0) throw new Error(`primitive_cleanup_failed:${JSON.stringify(cleanup)}`);
  if (errors.length) throw new Error(`browser_console_errors:${errors.join(" | ")}`);
  console.log(JSON.stringify({ status: "passed", panels: [1, 2, 4, 8], intervals: ["1m", "5m", "15m", "1h"], restoredPixels, cleanup, evidencePath }));
} finally {
  await browser?.close().catch(() => {});
  await new Promise((resolveClose) => server.close(resolveClose));
}
