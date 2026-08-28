/* AA Embroidery DST Viewer
   DST decoding adapted from concepts used by leomurca/embroidery-viewer (MIT).
   This file renders locally selected DST files; no embroidery file is uploaded. */
(function(){
  const modal=document.createElement("div");
  modal.id="dstPreviewModal";
  modal.className="modal";
  modal.setAttribute("aria-hidden","true");
  modal.innerHTML='<div class="modal-panel dst-preview-panel" role="dialog" aria-modal="true" aria-label="DST Preview">'+
    '<div class="modal-head"><h2 id="dstPreviewHeading">DST Preview</h2><button id="dstPreviewClose" class="iconbtn dark" type="button">×</button></div>'+
    '<div class="dst-preview-toolbar"><span id="dstPreviewTitle" class="dst-preview-title"></span><button id="dstFit" class="secondary" type="button">FIT</button><button id="dstZoomOut" class="secondary" type="button">ZOOM −</button><button id="dstZoomIn" class="secondary" type="button">ZOOM +</button><button id="dstSave" class="secondary" type="button">SAVE PNG</button><button id="dstShare" class="secondary" type="button">SHARE</button></div>'+
    '<div class="dst-preview-main"><div id="dstStage" class="dst-preview-stage"><canvas id="dstCanvas"></canvas></div><aside class="dst-preview-side"><b>DST FILES</b><div id="dstFileList" class="dst-file-list"></div><div id="dstMeta" class="dst-meta"></div></aside></div>'+
    '<div id="dstPreviewPath" class="dst-preview-footer"></div></div>';
  document.body.appendChild(modal);
  const $=id=>document.getElementById(id);
  const canvas=$("dstCanvas"), ctx=canvas.getContext("2d");
  const stage=$("dstStage"), list=$("dstFileList"), meta=$("dstMeta");
  let current=null, model=null, zoom=1, panX=0, panY=0, drag=null;

  // Decoder and thread-style renderer adapted from leomurca/embroidery-viewer (MIT).
  const NORMAL=0,JUMP=1,TRIM=2,STOP=4,END=8;
  function shade(hex,percent){const n=parseInt(hex.slice(1),16),a=Math.round(2.55*percent);const r=Math.max(0,Math.min(255,(n>>16)+a)),g=Math.max(0,Math.min(255,((n>>8)&255)+a)),b=Math.max(0,Math.min(255,(n&255)+a));return "#"+(0x1000000+r*0x10000+g*0x100+b).toString(16).slice(1)}
  function decode(buffer){
    const b=new Uint8Array(buffer), pts=[]; let x=0,y=0,color=0,stitches=0,changes=0,prevJump=false;
    for(let p=512;p+2<b.length;p+=3){
      const a=b[p],c=b[p+1],d=b[p+2]; let flags=NORMAL;
      if(d===0xF3){flags=END;} else {if((d&0xC3)===0xC3)flags=TRIM|STOP; else {if(d&0x80)flags|=TRIM;if(d&0x40)flags|=STOP;}}
      let dx=0,dy=0;
      if(a&1)dx+=1;if(a&2)dx-=1;if(a&4)dx+=9;if(a&8)dx-=9;if(a&128)dy+=1;if(a&64)dy-=1;if(a&32)dy+=9;if(a&16)dy-=9;
      if(c&1)dx+=3;if(c&2)dx-=3;if(c&4)dx+=27;if(c&8)dx-=27;if(c&128)dy+=3;if(c&64)dy-=3;if(c&32)dy+=27;if(c&16)dy-=27;
      if(d&4)dx+=81;if(d&8)dx-=81;if(d&32)dy+=81;if(d&16)dy-=81;
      if(prevJump) flags|=JUMP; x+=dx;y+=dy;
      if(flags&STOP){color++;changes++;}
      pts.push({x,y,flags,color}); if(!(flags&(JUMP|TRIM|STOP|END)))stitches++;
      prevJump=!!(flags&JUMP); if(flags&END)break;
    }
    if(!pts.length)throw new Error("No stitch data found.");
    // The original viewer inverts the pattern vertically.
    pts.forEach(q=>q.y=-q.y);
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
    pts.forEach(q=>{if(!(q.flags&TRIM)){minX=Math.min(minX,q.x);maxX=Math.max(maxX,q.x);minY=Math.min(minY,q.y);maxY=Math.max(maxY,q.y)}});
    return {pts,minX,maxX,minY,maxY,width:(maxX-minX)/10,height:(maxY-minY)/10,stitches,changes};
  }
  function resize(){const r=stage.getBoundingClientRect();const dpr=devicePixelRatio||1;canvas.width=Math.max(1,Math.floor(r.width*dpr));canvas.height=Math.max(1,Math.floor(r.height*dpr));canvas.style.width=r.width+"px";canvas.style.height=r.height+"px";draw()}
  function fit(){if(!model)return;const w=model.maxX-model.minX||1,h=model.maxY-model.minY||1;const pad=50;zoom=Math.min((canvas.width-pad)/(w),(canvas.height-pad)/(h));panX=(canvas.width-w*zoom)/2-model.minX*zoom;panY=(canvas.height-h*zoom)/2+model.maxY*zoom;draw()}
  function draw(){if(!model||!canvas.width)return;ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);ctx.lineWidth=Math.max(2,3*(devicePixelRatio||1));ctx.lineJoin="round";
    let last=model.pts[0], active=colors[last.color%colors.length];
    for(let i=0;i<model.pts.length;i++){const q=model.pts[i];if(i>0)last=model.pts[i-1];
      const tx=q.x-last.x,ty=q.y-last.y,gw=Math.sqrt(tx*tx+ty*ty)||1;
      if(q.flags&(JUMP|TRIM|STOP|END)){if(q.flags&STOP)active=colors[q.color%colors.length];continue;}
      const x1=last.x*zoom+panX,y1=-last.y*zoom+panY,x2=q.x*zoom+panX,y2=-q.y*zoom+panY;
      const grad=ctx.createRadialGradient(x1,y1,0,x1,y1,Math.max(2,gw*zoom*1.4));
      grad.addColorStop(0,shade(active,-60));grad.addColorStop(.05,active);grad.addColorStop(.5,shade(active,60));grad.addColorStop(.9,active);grad.addColorStop(1,shade(active,-60));
      ctx.strokeStyle=grad;ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();
    }
  }
  async function select(file,button){try{$("dstPreviewHeading").textContent=file.name+" — Loading";model=decode(await file.arrayBuffer());current=file;list.querySelectorAll("button").forEach(b=>b.classList.remove("active"));button.classList.add("active");$("dstPreviewHeading").textContent=file.name;meta.innerHTML='<div><b>STITCHES (DRAWN)</b>'+model.stitches.toLocaleString("en-IN")+'</div><div><b>COLOR CHANGES</b>'+model.changes+'</div><div><b>DIMENSIONS</b>'+model.width.toFixed(1)+' × '+model.height.toFixed(1)+' mm</div>';resize();fit()}catch(e){meta.innerHTML='<div><b>ERROR</b>'+String(e.message||e)+'</div>';}}
  function open(data){$("dstPreviewTitle").textContent=data.title||"Design Preview";$("dstPreviewPath").textContent=data.folderPath||"";list.innerHTML="";model=null;modal.classList.add("open");modal.setAttribute("aria-hidden","false");data.files.forEach((f,i)=>{const b=document.createElement("button");b.type="button";b.className="dst-file-btn";b.textContent=f.name;b.onclick=()=>select(f,b);list.appendChild(b);if(i===0)setTimeout(()=>select(f,b),0)});setTimeout(resize,0)}
  function makeBlob(){return new Promise(resolve=>canvas.toBlob(resolve,"image/png"))}
  async function save(){if(!current||!model)return;const blob=await makeBlob();const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=(current.name.replace(/\.dst$/i,"")||"embroidery-design")+"_preview.png";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
  async function share(){if(!current||!model)return;const blob=await makeBlob();const file=new File([blob],(current.name.replace(/\.dst$/i,"")||"embroidery-design")+"_preview.png",{type:"image/png"});if(navigator.share&&navigator.canShare&&navigator.canShare({files:[file]})){try{await navigator.share({title:current.name,text:"Embroidery design preview",files:[file]});}catch(e){if(e.name!=="AbortError")await save();}}else{await save();alert("This browser does not support direct sharing. The PNG was downloaded; you can send it through WhatsApp.");}}
  function close(){modal.classList.remove("open");modal.setAttribute("aria-hidden","true");}
  $("dstPreviewClose").onclick=close;modal.addEventListener("click",e=>{if(e.target===modal)close()});$("dstFit").onclick=fit;$("dstZoomIn").onclick=()=>{zoom*=1.25;draw()};$("dstZoomOut").onclick=()=>{zoom/=1.25;draw()};
  canvas.addEventListener("pointerdown",e=>{drag={x:e.clientX,y:e.clientY,px:panX,py:panY};canvas.setPointerCapture(e.pointerId)});
  canvas.addEventListener("pointermove",e=>{if(!drag)return;panX=drag.px+(e.clientX-drag.x)*(devicePixelRatio||1);panY=drag.py+(e.clientY-drag.y)*(devicePixelRatio||1);draw()});
  canvas.addEventListener("pointerup",()=>drag=null);canvas.addEventListener("wheel",e=>{e.preventDefault();zoom*=e.deltaY<0?1.12:1/1.12;draw()},{passive:false});
  window.addEventListener("resize",()=>{if(modal.classList.contains("open"))resize()});
  window.AADstViewer={open,close};
})();