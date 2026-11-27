// The Movie Map's drawing surface: a canvas page in a WebView (35,000 dots
// are too many for native views). It draws as src/components/movieMap/
// MapCanvas.tsx does — colour buckets, glow when zoomed out, rings for the
// selected film and its neighbours — and takes touch: drag to pan, pinch
// to zoom, tap a film to select it. The app sends it the films (load), and
// what to show (select, focus, matches); it reports taps back.
export const MAP_PAGE = `<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>html,body{margin:0;height:100%;background:#0a0a0a;overflow:hidden;touch-action:none}canvas{display:block;width:100%;height:100%}</style>
</head><body><canvas id="c"></canvas><script>
(function(){
var SIZE=10000,TAU=Math.PI*2,CELL=50,MAXZ=220,MINZ=0.7;
var c=document.getElementById('c'),ctx=c.getContext('2d');
var D=null,P=null,cam={x:SIZE/2,y:SIZE/2,k:0.1},view={w:0,h:0,dpr:1,fit:0.1};
var selected=null,similar=[],matches=null,anim=null,queued=false;
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function post(m){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify(m));}
function resize(){view.dpr=window.devicePixelRatio||1;view.w=innerWidth;view.h=innerHeight;c.width=view.w*view.dpr;c.height=view.h*view.dpr;view.fit=Math.min(view.w,view.h)/SIZE*1.05;if(!D)cam.k=view.fit;draw();}
function prepare(){var groups={};for(var i=0;i<D.count;i++){var col=D.color[i];var q=(((col>>19)&31)<<10)|(((col>>11)&31)<<5)|((col>>3)&31);(groups[q]=groups[q]||[]).push(i);}
var ch=function(v){return Math.round(v*255/31)};var buckets=[];for(var k in groups){var q=+k;buckets.push({css:'rgb('+ch((q>>10)&31)+','+ch((q>>5)&31)+','+ch(q&31)+')',films:groups[k]});}
var maxV=1;for(i=0;i<D.count;i++)maxV=Math.max(maxV,D.votes[i]);var lo=Math.log(50),span=Math.log(maxV)-lo||1;var w=new Float32Array(D.count);for(i=0;i<D.count;i++)w[i]=0.7+0.9*clamp((Math.log(D.votes[i])-lo)/span,0,1);
var cols=Math.ceil(SIZE/CELL)+1;var cellOf=function(i){return Math.floor(D.y[i]/CELL)*cols+Math.floor(D.x[i]/CELL)};var start=new Int32Array(cols*cols+1);for(i=0;i<D.count;i++)start[cellOf(i)+1]++;for(var x=0;x<cols*cols;x++)start[x+1]+=start[x];var fill=start.slice(0,-1);var cells=new Int32Array(D.count);for(i=0;i<D.count;i++)cells[fill[cellOf(i)]++]=i;
P={buckets:buckets,weight:w,cols:cols,start:start,cells:cells};}
function draw(){if(queued)return;queued=true;requestAnimationFrame(function(){queued=false;paint();});}
function paint(){ctx.setTransform(view.dpr,0,0,view.dpr,0,0);ctx.clearRect(0,0,view.w,view.h);if(!D)return;
var k=cam.k,cx=cam.x,cy=cam.y,w=view.w,h=view.h,zoom=k/view.fit;var px=function(x){return(x-cx)*k+w/2},py=function(y){return(y-cy)*k+h/2};
var r=clamp(1.15*Math.sqrt(zoom),1.1,7),m=12/k,x0=cx-w/2/k-m,x1=cx+w/2/k+m,y0=cy-h/2/k-m,y1=cy+h/2/k+m;
var vis=function(i){return D.x[i]>=x0&&D.x[i]<=x1&&D.y[i]>=y0&&D.y[i]<=y1};var size=function(i){return matches&&matches[i]?Math.max(2.2,r*P.weight[i]*1.5):r*P.weight[i]};
var glow=zoom<3,perPx=D.count/Math.pow(SIZE*k,2);ctx.globalCompositeOperation=glow?'lighter':'source-over';
var passes=matches?[0,1]:[1];for(var p=0;p<passes.length;p++){var pass=passes[p];ctx.globalAlpha=pass===0?0.07:matches?1:glow?clamp(0.11/Math.sqrt(perPx),0.22,0.9):0.95;
for(var b=0;b<P.buckets.length;b++){var bk=P.buckets[b];ctx.fillStyle=bk.css;if(r<2.4){for(var j=0;j<bk.films.length;j++){var i=bk.films[j];if((matches&&matches[i]!==pass)||!vis(i))continue;var s=size(i);ctx.fillRect(px(D.x[i])-s,py(D.y[i])-s,s*2,s*2);}}else{ctx.beginPath();for(j=0;j<bk.films.length;j++){i=bk.films[j];if((matches&&matches[i]!==pass)||!vis(i))continue;s=size(i);var X=px(D.x[i]),Y=py(D.y[i]);ctx.moveTo(X+s,Y);ctx.arc(X,Y,s,0,TAU);}ctx.fill();}}}
ctx.globalCompositeOperation='source-over';ctx.globalAlpha=1;
var ring=function(i,col,extra,lw){ctx.beginPath();ctx.arc(px(D.x[i]),py(D.y[i]),size(i)+extra,0,TAU);ctx.strokeStyle=col;ctx.lineWidth=lw||1.5;ctx.stroke();};
ctx.textBaseline='middle';ctx.font='600 12px system-ui,sans-serif';
var label=function(i,col){var X=px(D.x[i])+size(i)+5,Y=py(D.y[i]);ctx.lineJoin='round';ctx.lineWidth=3.5;ctx.strokeStyle='rgba(10,10,10,0.9)';ctx.strokeText(D.titles[i],X,Y);ctx.fillStyle=col;ctx.fillText(D.titles[i],X,Y);};
if(zoom<4&&D.regions){ctx.font='700 13px system-ui,sans-serif';ctx.textAlign='center';for(var g=0;g<D.regions.length;g++){var R=D.regions[g];if(R.size<(zoom<1.5?250:80))continue;ctx.lineWidth=4;ctx.strokeStyle='rgba(10,10,10,0.85)';ctx.strokeText(R.label,px(R.x),py(R.y));ctx.fillStyle='rgba(255,255,255,0.85)';ctx.fillText(R.label,px(R.x),py(R.y));}ctx.textAlign='left';ctx.font='600 12px system-ui,sans-serif';}
if(selected!==null){ctx.beginPath();for(var n=0;n<similar.length;n++){ctx.moveTo(px(D.x[selected]),py(D.y[selected]));ctx.lineTo(px(D.x[similar[n]]),py(D.y[similar[n]]));}ctx.strokeStyle='rgba(255,153,0,0.45)';ctx.lineWidth=1.2;ctx.stroke();
for(n=0;n<similar.length;n++){ring(similar[n],'rgba(255,153,0,0.95)',2.5);if(zoom>2)label(similar[n],'rgba(255,255,255,0.8)');}
ctx.beginPath();ctx.arc(px(D.x[selected]),py(D.y[selected]),size(selected)+1.5,0,TAU);ctx.fillStyle='#ff9900';ctx.fill();ring(selected,'#fff',4,2);label(selected,'#fff');}}
function hit(sx,sy){if(!D)return null;var mx=(sx-view.w/2)/cam.k+cam.x,my=(sy-view.h/2)/cam.k+cam.y,best=null,bd=Math.pow(22/cam.k,2);var cx0=Math.floor(mx/CELL),cy0=Math.floor(my/CELL),reach=Math.ceil(22/cam.k/CELL);
for(var yy=cy0-reach;yy<=cy0+reach;yy++)for(var xx=cx0-reach;xx<=cx0+reach;xx++){if(xx<0||yy<0||xx>=P.cols||yy>=P.cols)continue;var cell=yy*P.cols+xx;for(var q=P.start[cell];q<P.start[cell+1];q++){var i=P.cells[q];if(matches&&!matches[i])continue;var d=Math.pow(D.x[i]-mx,2)+Math.pow(D.y[i]-my,2);if(d<bd){bd=d;best=i;}}}return best;}
function animate(to,ms){anim={from:{x:cam.x,y:cam.y,k:cam.k},to:to,start:performance.now(),ms:ms||700};step();}
function step(){if(!anim)return;var t=Math.min(1,(performance.now()-anim.start)/anim.ms),e=t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;var f=anim.from,to=anim.to;var lk=Math.log(f.k)+(Math.log(to.k)-Math.log(f.k))*e;cam={x:f.x+(to.x-f.x)*e,y:f.y+(to.y-f.y)*e,k:Math.exp(lk)};paint();if(t<1)requestAnimationFrame(step);else anim=null;}
var touches={},last=null,moved=false,downAt=0;
function pts(){return Object.keys(touches).map(function(k){return touches[k]})}
c.addEventListener('touchstart',function(e){anim=null;for(var i=0;i<e.changedTouches.length;i++){var t=e.changedTouches[i];touches[t.identifier]={x:t.clientX,y:t.clientY};}moved=false;downAt=Date.now();last=null;e.preventDefault();},{passive:false});
c.addEventListener('touchmove',function(e){for(var i=0;i<e.changedTouches.length;i++){var t=e.changedTouches[i];touches[t.identifier]={x:t.clientX,y:t.clientY};}var p=pts();var g;if(p.length>=2){g={x:(p[0].x+p[1].x)/2,y:(p[0].y+p[1].y)/2,d:Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y)};}else if(p.length===1){g={x:p[0].x,y:p[0].y,d:0};}
if(last&&g&&last.n===p.length){var dx=g.x-last.x,dy=g.y-last.y;if(Math.abs(dx)+Math.abs(dy)>3)moved=true;if(p.length>=2&&last.d>0){var nk=clamp(cam.k*g.d/last.d,view.fit*MINZ,view.fit*MAXZ);var mx=(g.x-view.w/2)/cam.k+cam.x,my=(g.y-view.h/2)/cam.k+cam.y;cam.k=nk;cam.x=mx-(g.x-view.w/2)/nk;cam.y=my-(g.y-view.h/2)/nk;moved=true;}cam.x-=dx/cam.k;cam.y-=dy/cam.k;draw();}
if(g)last={x:g.x,y:g.y,d:g.d,n:p.length};e.preventDefault();},{passive:false});
c.addEventListener('touchend',function(e){for(var i=0;i<e.changedTouches.length;i++){var t=e.changedTouches[i];delete touches[t.identifier];if(!moved&&Date.now()-downAt<400&&pts().length===0){var f=hit(t.clientX,t.clientY);post({t:'tap',i:f});}}last=null;},{passive:false});
var lastTap=0;c.addEventListener('touchend',function(e){if(moved)return;var now=Date.now();if(now-lastTap<300){var t=e.changedTouches[0];var mx=(t.clientX-view.w/2)/cam.k+cam.x,my=(t.clientY-view.h/2)/cam.k+cam.y;animate({x:mx,y:my,k:clamp(cam.k*2.2,view.fit*MINZ,view.fit*MAXZ)},350);}lastTap=now;});
window.__map={
load:function(d){D=d;D.count=d.x.length;prepare();cam={x:SIZE/2,y:SIZE/2,k:view.fit};paint();post({t:'ready'});},
select:function(i,sim){selected=i;similar=sim||[];draw();},
focus:function(i){if(i===null||i===undefined)return;var k=Math.max(cam.k,view.fit*9);animate({x:D.x[i],y:D.y[i]+(view.h*0.18)/k,k:k});},
matches:function(list){if(!list){matches=null;draw();return;}matches=new Uint8Array(D.count);for(var i=0;i<list.length;i++)matches[list[i]]=1;draw();},
home:function(){animate({x:SIZE/2,y:SIZE/2,k:view.fit});}
};
window.addEventListener('resize',resize);resize();post({t:'boot'});
})();
</script></body></html>`;
