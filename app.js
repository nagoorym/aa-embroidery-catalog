const state={
  rows:[],
  folderHandle:null,
  stop:false,
  rate:Number(localStorage.getItem("aa_rate")||10),
  sleeveMultiplier:Number(localStorage.getItem("aa_sleeve_multiplier")||2),
  catalogName:localStorage.getItem("aa_catalog_name")||"",
  loadedAt:localStorage.getItem("aa_catalog_loaded_at")||"",
  rootPath:localStorage.getItem("aa_root_path")||"C:\\Embroidery",
  rootFolderName:localStorage.getItem("aa_root_folder_name")||"",
  rootHandle:null
};
const $=id=>document.getElementById(id);
const fmt=n=>Number(n||0).toLocaleString("en-IN");
const money=n=>"₹"+fmt(n);
function toast(msg){const t=$("toast");t.textContent=msg;t.style.display="block";setTimeout(()=>t.style.display="none",2200)}
function setView(name){
  document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));
  $("view-"+name).classList.add("active");
  document.querySelectorAll(".navitem,.mobile-navitem").forEach(b=>b.classList.toggle("active",b.dataset.view===name));
  $("drawer").classList.remove("open");$("shade").classList.remove("open");
  if(name==="info")renderInfo();
  window.scrollTo({top:0,behavior:"smooth"});
}
$("menuBtn").onclick=()=>{$("drawer").classList.add("open");$("shade").classList.add("open")};
$("topPickFolder").onclick=async()=>{setView("scan"); await pickEmbroideryFolder();};
$("sidePickFolder").onclick=async()=>{setView("scan"); await pickEmbroideryFolder();};
$("topScan").onclick=async()=>{setView("scan"); if(!state.rootHandle){await pickEmbroideryFolder();} if(state.rootHandle) await startScan();};
$("closeMenu").onclick=$("shade").onclick=()=>{$("drawer").classList.remove("open");$("shade").classList.remove("open")};
document.querySelectorAll(".navitem,.mobile-navitem").forEach(b=>b.onclick=()=>setView(b.dataset.view));
$("refreshBtn").onclick=()=>{renderInfo();toast("Catalog refreshed")};
$("closeDetails").onclick=closeFolderDetails;
$("detailsModal").addEventListener("click",e=>{if(e.target.id==="detailsModal")closeFolderDetails()});
document.addEventListener("keydown",e=>{if(e.key==="Escape"){closeFolderDetails()}});

function normalizeRow(r){
  const get=(...names)=>{for(const n of names){if(r[n]!==undefined&&r[n]!==null&&String(r[n]).trim()!=="")return r[n]}return ""};
  return {
    collection:String(get("Collection")).trim(),
    path:String(get("Path")).trim(),
    folder:String(get("Folder")).trim(),
    design:String(get("Design")).trim(),
    filename:String(get("Filename")).trim(),
    component:String(get("Component")).trim()||componentFrom(r.Filename||""),
    format:String(get("Format")).trim().toUpperCase(),
    stitches:Number(get("Stitches","Actual Stitches"))||0,
    review:String(get("Review")).trim()
  };
}
function componentFrom(name){
  const n=String(name).toLowerCase().replace(/\.[^.]+$/,"");
  if(/\bback\b/.test(n))return "Back";
  if(/\bfront\b/.test(n))return "Front";
  if(/\b(full\s*neck|fullneck)\b/.test(n))return "Full Neck";
  if(/\bneck\b/.test(n))return "Neck";
  if(/\b(hand|sleeve)\b/.test(n))return "Sleeve/Hand";
  if(/\bbooti\b|\bbuti\b/.test(n))return "Buti";
  if(/\bpatch\b/.test(n))return "Patch";
  if(/\blogo\b/.test(n))return "Logo";
  return "Other";
}
async function readWorkbook(file){
  if(!window.XLSX)throw new Error("Excel engine is not loaded. Connect to the internet once and reload the app.");
  const buf=await file.arrayBuffer();
  const wb=XLSX.read(buf,{type:"array"});
  const sheet=wb.Sheets[wb.SheetNames.includes("FILES")?"FILES":wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet,{defval:""}).map(normalizeRow);
}
function saveCatalog(rows,name){
  state.rows=rows;
  state.catalogName=name||"catalog";
  state.loadedAt=new Date().toLocaleString();
  localStorage.setItem("aa_catalog_name",state.catalogName);
  localStorage.setItem("aa_catalog_loaded_at",state.loadedAt);
  // Keep catalog in IndexedDB; localStorage is only metadata.
  return saveRowsDB(rows);
}
function openDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open("AAEmbroideryDB",1);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains("catalog"))db.createObjectStore("catalog");
      if(!db.objectStoreNames.contains("settings"))db.createObjectStore("settings");
    };
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });
}
async function saveRowsDB(rows){
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction("catalog","readwrite");tx.objectStore("catalog").put(rows,"rows");
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
  });
}
async function saveRootHandle(handle){
  try{
    const db=await openDB();
    await new Promise((resolve,reject)=>{
      const tx=db.transaction("settings","readwrite");
      tx.objectStore("settings").put(handle,"rootHandle");
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
    });
  }catch(e){ console.warn("Could not persist folder handle",e); }
}
async function loadRootHandle(){
  try{
    const db=await openDB();
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction("settings","readonly");
      const req=tx.objectStore("settings").get("rootHandle");
      req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error);
    });
  }catch(e){return null}
}
async function clearRootHandle(){
  try{
    const db=await openDB();
    await new Promise((resolve,reject)=>{
      const tx=db.transaction("settings","readwrite");
      tx.objectStore("settings").delete("rootHandle");
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
    });
  }catch(e){}
}
async function ensureRootPermission(){
  if(!state.rootHandle)return false;
  try{
    if(state.rootHandle.queryPermission){
      const p=await state.rootHandle.queryPermission({mode:"read"});
      if(p==="granted")return true;
      const r=await state.rootHandle.requestPermission({mode:"read"});
      return r==="granted";
    }
    return true;
  }catch(e){return false}
}
async function getDirectoryByPath(relativePath){
  if(!state.rootHandle)return null;
  const parts=String(relativePath||"").split(/[\\/]+/).filter(Boolean);
  // The stored group path is relative to the root collection, e.g. 500-1000Designs/700-800/P786.
  let dir=state.rootHandle;
  for(const part of parts){
    dir=await dir.getDirectoryHandle(part,{create:false});
  }
  return dir;
}
async function loadRowsDB(){
  try{
    const db=await openDB();
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction("catalog","readonly"),req=tx.objectStore("catalog").get("rows");
      req.onsuccess=()=>resolve(req.result||[]);req.onerror=()=>reject(req.error);
    });
  }catch(e){return []}
}
$("excelInput").onchange=async e=>{
  const file=e.target.files[0];if(!file)return;
  $("loadStatus").textContent="Reading "+file.name+"...";
  try{
    const rows=await readWorkbook(file);
    await saveCatalog(rows,file.name);
    $("loadStatus").textContent=`Loaded ${fmt(rows.length)} file records from ${file.name}.`;
    toast("Catalog loaded");
    renderInfo();
  }catch(err){$("loadStatus").textContent="Load error: "+err.message}
};
$("clearCatalog").onclick=async()=>{
  state.rows=[];state.catalogName="";state.loadedAt="";
  localStorage.removeItem("aa_catalog_name");localStorage.removeItem("aa_catalog_loaded_at");
  const db=await openDB();await new Promise((resolve,reject)=>{const tx=db.transaction("catalog","readwrite");tx.objectStore("catalog").delete("rows");tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});
  $("loadStatus").textContent="Catalog cleared.";renderInfo();
};

function directoryPath(path){
  const parts=String(path||"").split(/[\\/]+/).filter(Boolean);
  if(parts.length>1) parts.pop();
  return parts.join("/");
}
function groupDesigns(rows){
  // One result = one design folder within one collection.
  // Filenames are never used to split a design into separate results.
  const map=new Map();
  for(const r of rows){
    const folder=r.folder || directoryPath(r.path).split(/[\\/]+/).pop() || "";
    const key=[r.collection,folder,r.design].join("||");
    if(!map.has(key)){
      map.set(key,{
        collection:r.collection,
        folder,
        path:directoryPath(r.path),
        design:r.design,
        rows:[]
      });
    }
    map.get(key).rows.push(r);
  }
  return [...map.values()];
}
function designCost(group,selected){
  let stitches=0,units=0,cost=0;
  for(const r of selected){
    const qty=r.component==="Sleeve/Hand"?state.sleeveMultiplier:1;
    const s=r.stitches*qty;
    const u=Math.floor(s/1000);
    stitches+=s;units+=u;cost+=u*state.rate;
  }
  return {stitches,units,cost};
}
function renderGroup(group){
  const box=document.createElement("div");box.className="result";
  const head=document.createElement("div");head.className="resulthead";
  head.innerHTML=`<h3>Design ${escapeHtml(group.design)}</h3><div class="muted">${escapeHtml(group.collection)} · Folder: ${escapeHtml(group.folder)}<br>${escapeHtml(group.path)}</div>`;
  box.appendChild(head);
  const comps=document.createElement("div");comps.className="components";
  const valid=group.rows.filter(r=>r.stitches>0);
  valid.forEach((r,i)=>{
    const row=document.createElement("label");row.className="comp";
    const sleeve=r.component==="Sleeve/Hand";
    row.innerHTML=`<input type="checkbox" data-i="${i}"><span><span class="compname">${escapeHtml(r.component)}</span><br><span class="file">${escapeHtml(r.filename)} · ${fmt(r.stitches)} stitches${sleeve?" · sleeve ×"+state.sleeveMultiplier:""}</span></span><span>${sleeve?"×"+state.sleeveMultiplier:"×1"}</span><span>${money(Math.floor((r.stitches*(sleeve?state.sleeveMultiplier:1))/1000)*state.rate)}</span>`;
    comps.appendChild(row);
  });
  const actions=document.createElement("div");actions.className="result-actions";
  const detailBtn=document.createElement("button");detailBtn.className="secondary detail-btn";detailBtn.type="button";detailBtn.textContent="DETAILS";
  detailBtn.onclick=()=>showFolderDetails(group);
  actions.appendChild(detailBtn);

  const calc=document.createElement("div");calc.className="calc";
  calc.innerHTML=`<div>Actual stitches<b class="ct">0</b></div><div>Billable units<b class="cu">0</b></div><div>Total cost<b class="cc">₹0</b></div>`;
  box.appendChild(comps);box.appendChild(actions);box.appendChild(calc);
  const update=()=>{
    const selected=[...comps.querySelectorAll("input:checked")].map(x=>valid[Number(x.dataset.i)]);
    const c=designCost(group,selected);
    calc.querySelector(".ct").textContent=fmt(c.stitches);
    calc.querySelector(".cu").textContent=fmt(c.units);
    calc.querySelector(".cc").textContent=money(c.cost);
  };
  comps.addEventListener("change",update);
  return box;
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}

function showFolderDetails(group){
  const modal=$("detailsModal");
  const body=$("detailsBody");
  const title=$("detailsTitle");
  title.textContent=`Design ${group.design} — Folder Details`;
  body.innerHTML="";
  const fullPath=state.rootPath.replace(/[\\/]+$/,"")+"\\"+group.path.replace(/[\\/]+/g,"\\");
  const wrap=document.createElement("div");
  wrap.innerHTML=`
    <div class="detail-meta">
      <b>Collection:</b> ${escapeHtml(group.collection)}<br>
      <b>Folder:</b> ${escapeHtml(group.folder)}<br>
      <b>Relative path:</b> ${escapeHtml(group.path)}<br>
      <b>Exact location:</b><div class="path detail-path">${escapeHtml(fullPath)}</div>
      <b>Files:</b> ${fmt(group.rows.length)}
      <div class="buttonrow detail-actions">
        <button id="copyFolderPathBtn" class="secondary">📋 COPY PATH</button>
      </div>
    </div>
  `;
  body.appendChild(wrap);
  $("copyFolderPathBtn").onclick=async()=>{
    try{await navigator.clipboard.writeText(fullPath);toast("Folder path copied");}
    catch(e){toast("Copy failed — select the path manually");}
  };

  const table=document.createElement("table");
  table.className="detail-table";
  table.innerHTML=`<thead><tr><th>Filename</th><th>Component</th><th>Format</th><th>Actual Stitches</th><th>Pricing</th></tr></thead>`;
  const tbody=document.createElement("tbody");

  group.rows.forEach(r=>{
    const tr=document.createElement("tr");
    const sleeve=r.component==="Sleeve/Hand";
    const qty=sleeve?state.sleeveMultiplier:1;
    const chargedStitches=r.stitches*qty;
    const units=Math.floor(chargedStitches/1000);
    const cost=units*state.rate;
    tr.innerHTML=`
      <td>${escapeHtml(r.filename)}</td>
      <td>${escapeHtml(r.component||"Other")}</td>
      <td>${escapeHtml(r.format)}</td>
      <td>${fmt(r.stitches)}</td>
      <td>${sleeve?`×${qty} · ${fmt(chargedStitches)} → ${money(cost)}`:`×1 · ${money(cost)}`}</td>
    `;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  body.appendChild(table);
  modal.classList.add("open");
  modal.setAttribute("aria-hidden","false");
}
function closeFolderDetails(){
  const modal=$("detailsModal");
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden","true");
}
function searchDesign(){
  const q=$("designInput").value.trim().toLowerCase();
  const out=$("designResults");out.innerHTML="";
  if(!q){$("catalogStatus").textContent="Enter a design number.";return}
  if(!state.rows.length){$("catalogStatus").textContent="No catalog loaded. Use Update Catalog first.";return}
  const groups=groupDesigns(state.rows).filter(g=>g.design.toLowerCase()===q);
  $("catalogStatus").textContent=`${fmt(groups.length)} matching collection/folder record${groups.length===1?"":"s"} found.`;
  groups.forEach(g=>out.appendChild(renderGroup(g)));
}
$("designSearchBtn").onclick=searchDesign;
$("designInput").onkeydown=e=>{if(e.key==="Enter")searchDesign()};

function priceSearch(){
  const min=$("minPrice").value===""?0:Number($("minPrice").value);
  const max=$("maxPrice").value===""?Infinity:Number($("maxPrice").value);
  const comp=$("priceComponent").value;
  const groups=groupDesigns(state.rows);
  const out=[];
  for(const g of groups){
    let rows=g.rows.filter(r=>r.stitches>0);
    if(comp)rows=rows.filter(r=>r.component===comp);
    // Price-search estimate includes all recognized components by default.
    const c=designCost(g,rows);
    if(c.cost>=min&&c.cost<=max)out.push({...g,c});
  }
  out.sort((a,b)=>a.c.cost-b.c.cost||String(a.design).localeCompare(String(b.design),undefined,{numeric:true}));
  const box=$("priceResults");box.innerHTML="";
  if(!state.rows.length){box.innerHTML='<div class="card">Load a catalog first.</div>';return}
  const summary=document.createElement("div");summary.className="status";summary.textContent=`${fmt(out.length)} matching collection/folder records`;box.appendChild(summary);
  out.slice(0,500).forEach(g=>{
    const d=document.createElement("div");d.className="priceitem";
    const info=document.createElement("span");
    info.innerHTML=`<b>Design ${escapeHtml(g.design)}</b><br><span class="muted">${escapeHtml(g.collection)} · Folder: ${escapeHtml(g.folder)}</span><br><span class="muted">${fmt(g.c.stitches)} stitches · ${fmt(g.c.units)} units</span>`;
    const right=document.createElement("span");right.className="price-right";
    const cost=document.createElement("b");cost.textContent=money(g.c.cost);
    const detail=document.createElement("button");detail.type="button";detail.className="secondary detail-btn";detail.textContent="DETAILS";
    detail.onclick=()=>showFolderDetails(g);
    right.appendChild(cost);right.appendChild(detail);
    d.appendChild(info);d.appendChild(right);
    box.appendChild(d);
  });
}
$("priceSearchBtn").onclick=priceSearch;

function renderInfo(){
  $("infoCard").innerHTML=`
  <b>Catalog:</b> ${escapeHtml(state.catalogName||"Not loaded")}<br>
  <b>Records:</b> ${fmt(state.rows.length)}<br>
  <b>Unique collection/folder/design groups:</b> ${fmt(groupDesigns(state.rows).length)}<br>
  <b>Last loaded:</b> ${escapeHtml(state.loadedAt||"—")}<br>
  <b>Rate:</b> ${money(state.rate)} per 1,000 billable stitches<br>
  <b>Sleeve multiplier:</b> ×${state.sleeveMultiplier}<br>
  <b>Embroidery root:</b> ${escapeHtml(state.rootPath)}<br>
  <b>Folder permission:</b> ${state.rootHandle?"Connected":"Not connected"}`;
}
$("rateInput").value=state.rate;$("sleeveMultiplier").value=state.sleeveMultiplier;
$("saveSettings").onclick=()=>{
  state.rate=Math.max(0,Number($("rateInput").value)||0);
  state.sleeveMultiplier=Math.max(1,Number($("sleeveMultiplier").value)||2);
  localStorage.setItem("aa_rate",state.rate);localStorage.setItem("aa_sleeve_multiplier",state.sleeveMultiplier);
  toast("Settings saved");
};

function folderDesign(folder){
  const s=String(folder).trim();
  let m=s.match(/^P(\d+)$/i);if(m)return m[1];
  m=s.match(/^(\d+)$/);if(m)return m[1];
  m=s.match(/^H(\d+)$/i);if(m)return m[1];
  return "";
}
function componentFromFile(name){return componentFrom(name)}
async function dstStitches(file){
  const buf=await file.slice(0,512).arrayBuffer(), bytes=new Uint8Array(buf);
  let text="";for(const b of bytes)text+=String.fromCharCode(b);
  const m=text.match(/ST:\s*(\d+)/i);return m?Number(m[1]):0;
}
async function walk(dir,relative="",designFolder="",collection="",out=[]){
  for await(const [name,handle] of dir.entries()){
    if(state.stop)break;
    const rel=relative?relative+"/"+name:name;
    if(handle.kind==="directory"){
      if(name.toUpperCase()==="LOST.DIR")continue;
      const d=folderDesign(name);
      await walk(handle,rel,d||designFolder,collection||name,out);
    }else{
      const ext=name.split(".").pop().toUpperCase();
      if(ext!=="DST"&&ext!=="EMB")continue;
      const file=await handle.getFile();
      let stitches=0,review="";
      if(ext==="DST"){try{stitches=await dstStitches(file);if(!stitches)review="Stitch count not found"}catch(e){review="DST read failed"}}
      else review="EMB recorded; use matching DST for stitch count when available";
      out.push({
        collection:relative.split("/")[0]||rootName||"",
        path:rel,folder:designFolder||"",design:designFolder||"",
        filename:name,component:componentFromFile(name),format:ext,stitches,review
      });
      updateScanStats(out);
    }
  }
  return out;
}
let rootName="";
function updateScanStats(rows){
  $("statFiles").textContent=fmt(rows.length);
  $("statDst").textContent=fmt(rows.filter(r=>r.format==="DST").length);
  $("statEmb").textContent=fmt(rows.filter(r=>r.format==="EMB").length);
  $("statDesigns").textContent=fmt(new Set(rows.map(r=>r.design).filter(Boolean)).size);
  $("statReview").textContent=fmt(rows.filter(r=>r.review).length);
  if(rows.length%50===0)$("scanStatus").textContent=`Scanning... ${fmt(rows.length)} files`;
}
async function pickEmbroideryFolder(){
  if(!window.showDirectoryPicker){
    toast("Folder selection requires Chrome or Edge on Windows/tablet.");
    return false;
  }
  try{
    const handle=await window.showDirectoryPicker({mode:"read"});
    state.rootHandle=handle;
    state.folderHandle=handle;
    rootName=handle.name;
    state.rootFolderName=rootName;
    localStorage.setItem("aa_root_folder_name",rootName);
    $("rootPathInput").value=state.rootPath;
    $("folderPath").textContent=`Selected: ${rootName}`;
    $("scanBtn").disabled=false;
    $("scanStatus").textContent="Embroidery root selected. Ready to scan.";
    updateRootUI();
    await saveRootHandle(handle);
    toast("Embroidery folder connected");
    return true;
  }catch(e){
    if(e.name!=="AbortError") toast("Folder selection failed: "+e.message);
    return false;
  }
}
function updateRootUI(){
  const connected=!!state.rootHandle;
  const status=$("sideRootStatus");
  if(status) status.textContent=connected?"Connected":"Not connected";
  const dot=document.querySelector(".root-status .status-dot");
  if(dot) dot.style.background=connected?"#4aa85b":"#b8b8b8";
  if($("sideRootPath")) $("sideRootPath").textContent=state.rootPath;
  if($("topRootPath")) $("topRootPath").textContent=state.rootPath;
  if($("headingCatalogStatus")) $("headingCatalogStatus").textContent=connected?"Folder connected":"Catalog ready";
}
async function startScan(){
  if(!state.folderHandle){toast("Select the Embroidery root folder first.");return;}
  $("scanBtn").click();
}
$("pickFolder").onclick=pickEmbroideryFolder;

$("saveRootPath").onclick=()=>{
  const p=$("rootPathInput").value.trim();
  if(!p){toast("Enter the root folder path");return}
  state.rootPath=p.replace(/[\\/]+$/,"");
  localStorage.setItem("aa_root_path",state.rootPath);
  toast("Root path saved");
};
let scanRows=[];
$("scanBtn").onclick=async()=>{
  if(!state.folderHandle){
    const ok=await ensureRootPermission();
    if(!ok){toast("Select the Embroidery root folder first.");return;}
  }
  state.stop=false;scanRows=[];$("scanBtn").disabled=true;$("stopScan").disabled=false;$("exportXlsx").disabled=true;$("scanBar").style.width="5%";
  try{
    await walk(state.folderHandle,"","",rootName,scanRows);
    $("scanBar").style.width="100%";$("scanStatus").textContent=`Scan complete: ${fmt(scanRows.length)} files.`;
    $("exportXlsx").disabled=!scanRows.length;
  }catch(e){$("scanStatus").textContent="Scan error: "+e.message}
  finally{$("scanBtn").disabled=false;$("stopScan").disabled=true}
};
$("stopScan").onclick=()=>{state.stop=true;$("scanStatus").textContent="Stopping..."};

$("exportXlsx").onclick=()=>{
  if(!window.XLSX){$("scanStatus").textContent="Excel engine is not loaded.";return}
  const data=scanRows.map(r=>({
    CatalogVersion:"AA Embroidery Master Catalog V2",
    Collection:r.collection,Path:r.path,Folder:r.folder,Design:r.design,
    Filename:r.filename,Component:r.component,Format:r.format,
    "Actual Stitches":r.stitches,Quantity:"", "Billable Units":"",
    Cost:"",Review:r.review,DesignSource:"Immediate design folder name only"
  }));
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(data),"FILES");
  const groups=groupDesigns(scanRows).map(g=>({Collection:g.collection,Path:g.path,Folder:g.folder||"",Design:g.design}));
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(groups),"DESIGNS");
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet([
    {Setting:"Default rate per 1,000 billable stitches",Value:state.rate},
    {Setting:"Sleeve multiplier",Value:state.sleeveMultiplier},
    {Setting:"Design number rule",Value:"Immediate design folder name only"},
    {Setting:"Source",Value:"C:\\Embroidery"}
  ]),"SETTINGS");
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(data.filter(r=>r.Review)),"REVIEW");
  XLSX.writeFile(wb,"AA_Embroidery_Master_Catalog.xlsx");
  toast("Excel exported");
};

(async()=>{
  state.rows=await loadRowsDB();
  state.rootHandle=await loadRootHandle();
  state.folderHandle=state.rootHandle;
  $("rateInput").value=state.rate;$("sleeveMultiplier").value=state.sleeveMultiplier;
  $("rootPathInput").value=state.rootPath;
  $("folderPath").textContent=state.rootFolderName?`Saved folder: ${state.rootFolderName}`:"No folder selected";
  $("scanBtn").disabled=!state.rootHandle;
  updateRootUI();
  renderInfo();
  if(state.rows.length) $("catalogStatus").textContent=`Catalog ready: ${fmt(state.rows.length)} records.`;
  if("serviceWorker" in navigator && location.protocol!=="file:"){
    navigator.serviceWorker.register("service-worker.js").catch(()=>{});
  }
})();

// Keep the mobile Home/Search controls intentionally lightweight: both open the design search workspace.
