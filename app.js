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
const MOTIF_CATEGORIES=[
  {id:"all",label:"All"},
  {id:"peacock",label:"🦚 Peacock",words:["peacock","mayil"]},
  {id:"leaf",label:"🌿 Leaf",words:["leaf","leaves"]},
  {id:"mango",label:"🥭 Mango / Paisley",words:["mango","paisley","mankolam"]},
  {id:"flower",label:"🌸 Flower",words:["flower","floral","lotus","rose"]},
  {id:"bird",label:"🐦 Bird",words:["bird","parrot","swan"]},
  {id:"elephant",label:"🐘 Elephant",words:["elephant"]},
  {id:"butta",label:"✨ Butta",words:["butta","buti","buty","butti","booti","boota"]},
  {id:"butterfly",label:"🦋 Butterfly",words:["butterfly"]},
  {id:"shape",label:"◇ Shapes",words:["u shape","v shape","round","square","boat","pot shape"]}
];
state.designMotif="all";state.priceMotif="all";
function rowMotifText(r){return [r.filename,r.folder,r.path,r.collection,r.design].join(" ").toLowerCase();}
function rowMatchesMotif(r,id){
  if(!id||id==="all")return true;
  const cat=MOTIF_CATEGORIES.find(x=>x.id===id);if(!cat)return true;
  const text=rowMotifText(r);
  return cat.words.some(w=>text.includes(w));
}
function priceBaseGroups(){
  const min=$("minPrice")&&$("minPrice").value===""?0:Number($("minPrice")?.value||0);
  const max=$("maxPrice")&&$("maxPrice").value===""?Infinity:Number($("maxPrice")?.value||Infinity);
  const comp=$("priceComponent")?.value||"";
  return groupDesigns(state.rows).filter(g=>{
    let rows=g.rows.filter(r=>r.stitches>0);
    if(comp)rows=rows.filter(r=>r.component===comp);
    const c=designCost(g,rows);
    return c.cost>=min&&c.cost<=max;
  });
}
function availablePriceMotifs(){
  const groups=priceBaseGroups();
  const ids=new Set(["all"]);
  for(const cat of MOTIF_CATEGORIES){
    if(cat.id!=="all"&&groups.some(g=>g.rows.some(r=>rowMatchesMotif(r,cat.id))))ids.add(cat.id);
  }
  return ids;
}
function renderMotifFilters(){
  const priceAvailable=availablePriceMotifs();
  if(state.priceMotif!=="all"&&!priceAvailable.has(state.priceMotif))state.priceMotif="all";
  const make=(target,key)=>{
    const el=$(target);if(!el)return;el.innerHTML="";
    MOTIF_CATEGORIES.forEach(cat=>{
      const unavailable=key==="priceMotif"&&!priceAvailable.has(cat.id);
      const b=document.createElement("button");
      b.type="button";
      b.className="motif-chip"+(state[key]===cat.id?" active":"")+(unavailable?" unavailable":"");
      b.textContent=cat.label;
      b.disabled=unavailable;
      b.onclick=()=>{
        if(unavailable)return;
        state[key]=cat.id;
        if(key==="designMotif")searchDesign();
        else priceSearch();
      };
      el.appendChild(b);
    });
  };
  make("designMotifFilters","designMotif");
  make("priceMotifFilters","priceMotif");
}
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

  const filename=String(get("Filename")).trim();
  const suppliedComponent=String(get("Component")).trim();
  const detectedComponent=componentFrom(filename);

  // Re-detect rows that were previously saved as "Other".
  // This lets an updated filename rule fix old catalogs without requiring
  // the user to edit every Excel row manually.
  const component=(!suppliedComponent || suppliedComponent.toLowerCase()==="other")
    ? detectedComponent
    : suppliedComponent;

  return {
    collection:String(get("Collection")).trim(),
    path:String(get("Path")).trim(),
    folder:String(get("Folder")).trim(),
    design:String(get("Design")).trim(),
    filename,
    component,
    format:String(get("Format")).trim().toUpperCase(),
    stitches:Number(get("Stitches","Actual Stitches"))||0,
    review:String(get("Review")).trim()
  };
}

function componentFrom(name){
  // File names in the source folders are not always consistently formatted.
  // Convert underscores, hyphens, dots, brackets, numbers, etc. into
  // searchable tokens so words such as "HAND" or "SLEEVE" are detected
  // anywhere in the file name, not only at the beginning.
  const raw=String(name||"").replace(/\.[^.]+$/,"");
  const n=raw
    .replace(/([a-z])([A-Z])/g,"$1 $2")
    .toLowerCase()
    .replace(/([a-z])(\d)/g,"$1 $2")
    .replace(/(\d)([a-z])/g,"$1 $2")
    .replace(/[^a-z]+/g," ")
    .trim();

  const has=(...words)=>words.some(word=>new RegExp("(^|\\s)"+word+"(?=\\s|$)","i").test(n));

  // Check more specific names before generic names.
  if(has("fullneck") || /(^|\\s)full\\s+neck(?=\\s|$)/i.test(n)) return "Full Neck";
  if(has("back")) return "Back";
  if(has("front")) return "Front";
  if(has("hand","hands","sleeve","sleeves","slv","slvhand","sleev")) return "Sleeve/Hand";
  if(has("neck")) return "Neck";
  if(has("booti","buti")) return "Buti";
  if(has("patch")) return "Patch";
  if(has("logo")) return "Logo";

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
    renderMotifFilters();
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
  // Qty = number of sets requested. Sleeve/Hand has a base ×2 charge
  // because one set normally means left + right. Every value below is
  // derived from the same formula so row amounts and the summary cannot drift.
  let actualStitches=0,billableStitches=0,units=0,cost=0;
  for(const item of selected){
    const r=item.row||item;
    const qty=Math.max(1,Math.trunc(Number(item.qty)||1));
    const multiplier=r.component==="Sleeve/Hand"?state.sleeveMultiplier:1;
    const actual=r.stitches*qty;
    const billable=actual*multiplier;
    const rowUnits=Math.floor(billable/1000);
    const rowCost=rowUnits*state.rate;
    actualStitches+=actual;
    billableStitches+=billable;
    units+=rowUnits;
    cost+=rowCost;
  }
  return {actualStitches,billableStitches,units,cost};
}

function renderGroup(group){
  const box=document.createElement("div");box.className="result design-workspace";
  const head=document.createElement("div");head.className="resulthead design-head";
  head.innerHTML=`
    <div><h3>Design ${escapeHtml(group.design)}</h3>
    <div class="muted design-meta">${escapeHtml(group.collection)} · Folder: ${escapeHtml(group.folder)}<br>${escapeHtml(group.path)}</div></div>
    <div class="sleeve-note"><b>ⓘ</b><span>Sleeve / Hand items are counted as <strong>×${state.sleeveMultiplier}</strong> by default<br>(for both left & right).<br>Use Qty to adjust the number of sets required.</span></div>`;
  box.appendChild(head);

  const comps=document.createElement("div");comps.className="components component-table";
  const tableHead=document.createElement("div");tableHead.className="comp table-head";
  tableHead.innerHTML=`<span>Include</span><span>Component</span><span>File & Stitches</span><span>Qty (units)</span><span>Multiplier</span><span>Amount</span>`;
  comps.appendChild(tableHead);

  const valid=group.rows.filter(r=>r.stitches>0);
  const rows=[];
  valid.forEach((r,i)=>{
    const sleeve=r.component==="Sleeve/Hand";
    const row=document.createElement("div");row.className="comp comp-row";
    row.innerHTML=`
      <div class="include-cell"><input type="checkbox" data-i="${i}" checked aria-label="Include ${escapeHtml(r.filename)}"></div>
      <div class="component-cell"><span class="component-icon ${sleeve?'sleeve':String(r.component).toLowerCase().replace(/\s+/g,'-')}">${sleeve?'✋':r.component==='Front'?'👕':r.component==='Full Neck'?'👚':'✦'}</span><span class="compname">${escapeHtml(r.component)}</span></div>
      <div class="file-cell"><b>${escapeHtml(r.filename)}</b><span>${fmt(r.stitches)} stitches</span></div>
      <div class="qty-cell"><div class="qty-control"><button type="button" class="qty-btn minus" aria-label="Decrease quantity">−</button><input class="qty-input" type="number" min="1" value="1" aria-label="Quantity"><button type="button" class="qty-btn plus" aria-label="Increase quantity">+</button></div><small>units</small></div>
      <div class="multiplier-cell">×${sleeve?state.sleeveMultiplier:1}</div>
      <div class="amount-cell">₹0</div>`;
    comps.appendChild(row);
    rows.push({row:r,el:row,qty:1});
  });

  const calc=document.createElement("div");calc.className="calc calc-expanded";
  calc.innerHTML=`
    <div>Actual stitches<b class="ct">0</b></div>
    <div>Billable stitches<b class="cb">0</b></div>
    <div>Billable units<b class="cu">0</b></div>
    <div class="total-cost">Total cost<b class="cc">₹0</b></div>
    <button type="button" class="secondary preview-design-btn">◉&nbsp; PREVIEW DESIGN</button>`;
  box.appendChild(comps);box.appendChild(calc);

  const update=()=>{
    const selected=[];
    rows.forEach(item=>{
      const check=item.el.querySelector('input[type="checkbox"]');
      const input=item.el.querySelector('.qty-input');
      item.qty=Math.max(1,Number(input.value)||1);
      input.value=item.qty;
      const sleeve=item.row.component==="Sleeve/Hand";
      const baseMultiplier=sleeve?state.sleeveMultiplier:1;
      const effectiveMultiplier=item.qty*baseMultiplier;
      const billable=item.row.stitches*effectiveMultiplier;
      const rowUnits=Math.floor(billable/1000);
      item.el.querySelector('.multiplier-cell').textContent='×'+effectiveMultiplier;
      item.el.querySelector('.amount-cell').textContent=money(rowUnits*state.rate);
      item.el.classList.toggle('not-included',!check.checked);
      if(check.checked)selected.push(item);
    });
    const c=designCost(group,selected);
    calc.querySelector('.ct').textContent=fmt(c.actualStitches);
    calc.querySelector('.cb').textContent=fmt(c.billableStitches);
    calc.querySelector('.cu').textContent=fmt(c.units);
    calc.querySelector('.cc').textContent=money(c.cost);
  };

  rows.forEach(item=>{
    const input=item.el.querySelector('.qty-input');
    item.el.querySelector('.minus').onclick=()=>{input.value=Math.max(1,(Number(input.value)||1)-1);update();};
    item.el.querySelector('.plus').onclick=()=>{input.value=(Number(input.value)||1)+1;update();};
    input.oninput=update;
    item.el.querySelector('input[type="checkbox"]').onchange=update;
  });
  calc.querySelector('.preview-design-btn').onclick=()=>openDesignPreview(group);
  update();
  return box;
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}

async function copyTextToClipboard(text){
  const value=String(text||"");
  if(!value)throw new Error("Nothing to copy");
  if(navigator.clipboard && window.isSecureContext){
    await navigator.clipboard.writeText(value);
    return true;
  }
  const textarea=document.createElement("textarea");
  textarea.value=value;
  textarea.setAttribute("readonly","");
  textarea.style.position="fixed";
  textarea.style.opacity="0";
  textarea.style.pointerEvents="none";
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0,textarea.value.length);
  const copied=document.execCommand("copy");
  document.body.removeChild(textarea);
  if(!copied)throw new Error("Copy command failed");
  return true;
}
function exactFolderPath(group){
  const root=String(state.rootPath||"").replace(/[\\/]+$/,"");
  const relative=String(group.path||"").replace(/[\\/]+/g,"\\");
  return relative ? `${root}\\${relative}` : root;
}
async function copyFolderPath(group,button){
  const path=exactFolderPath(group);
  const original=button.textContent;
  try{
    await copyTextToClipboard(path);
    button.textContent="COPIED ✓";
    button.classList.add("copied");
    toast("Folder path copied");
  }catch(e){
    button.textContent="COPY FAILED";
    toast("Copy failed — please try again");
  }
  setTimeout(()=>{
    button.textContent=original;
    button.classList.remove("copied");
  },1800);
}


// DST preview integration. Reads the actual selected folder through the
// File System Access API and passes real .DST File objects to dst-viewer.js.
async function openDesignPreview(group){
  if(!state.rootHandle){
    toast("Connect the Embroidery folder first.");
    setView("scan");
    return;
  }
  const ok=await ensureRootPermission();
  if(!ok){toast("Folder permission is required to preview DST files.");return;}
  try{
    const dir=await getDirectoryByPath(group.path);
    const files=[];
    for await(const [name,handle] of dir.entries()){
      if(handle.kind==="file" && name.toLowerCase().endsWith(".dst")){
        files.push(await handle.getFile());
      }
    }
    if(!files.length){toast("No DST files found in this design folder.");return;}
    if(!window.AADstViewer){toast("DST viewer is still loading. Reload and try again.");return;}
    window.AADstViewer.open({
      title:"Design "+group.design,
      folderPath:exactFolderPath(group),
      files
    });
  }catch(e){
    console.error(e);
    toast("Could not open the design folder: "+e.message);
  }
}

function showFolderDetails(group){
  const modal=$("detailsModal");
  const body=$("detailsBody");
  const title=$("detailsTitle");
  title.textContent=`Design ${group.design} — Folder Details`;
  body.innerHTML="";
  const fullPath=exactFolderPath(group);
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
  $("copyFolderPathBtn").onclick=()=>copyFolderPath(group,$("copyFolderPathBtn"));

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
  if(!state.rows.length){$("catalogStatus").textContent="No catalog loaded. Use Update Catalog first.";return}
  if(!q&&state.designMotif==="all"){
    $("catalogStatus").textContent="Enter a design number or choose a motif.";
    return;
  }
  const groups=groupDesigns(state.rows).filter(g=>{
    const numberMatch=!q||g.design.toLowerCase()===q;
    const motifMatch=g.rows.some(r=>rowMatchesMotif(r,state.designMotif));
    return numberMatch&&motifMatch;
  });
  const label=q?("Design "+q):(MOTIF_CATEGORIES.find(x=>x.id===state.designMotif)?.label||"Motif");
  $("catalogStatus").textContent=fmt(groups.length)+" matching record"+(groups.length===1?"":"s")+" for "+label+".";
  groups.forEach(g=>out.appendChild(renderGroup(g)));
}
$("designSearchBtn").onclick=searchDesign;
$("designInput").onkeydown=e=>{if(e.key==="Enter")searchDesign()};

function priceSearch(){
  const min=$("minPrice").value===""?0:Number($("minPrice").value);
  const max=$("maxPrice").value===""?Infinity:Number($("maxPrice").value);
  const comp=$("priceComponent").value;
  const groups=priceBaseGroups();
  const out=[];
  for(const g of groups){
    const motifMatch=g.rows.some(r=>rowMatchesMotif(r,state.priceMotif));
    if(!motifMatch)continue;
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
  renderMotifFilters();
  out.slice(0,500).forEach(g=>{
    const d=document.createElement("div");d.className="priceitem";
    const info=document.createElement("span");
    info.innerHTML=`<b>Design ${escapeHtml(g.design)}</b><br><span class="muted">${escapeHtml(g.collection)} · Folder: ${escapeHtml(g.folder)}</span><br><span class="muted">Total: ${fmt(g.c.actualStitches)} stitches · ${fmt(g.c.units)} units</span>`;
    const right=document.createElement("span");right.className="price-right";
    const cost=document.createElement("b");cost.textContent=money(g.c.cost);
    const previewBtn=document.createElement("button");previewBtn.type="button";previewBtn.className="secondary detail-btn preview-design-btn";previewBtn.textContent="◉ PREVIEW DESIGN";
    previewBtn.onclick=()=>openDesignPreview(g);
    right.appendChild(cost);right.appendChild(previewBtn);
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
    const previousFolderName=state.rootFolderName || rootName || "";
    state.rootHandle=handle;
    state.folderHandle=handle;
    rootName=handle.name;
    state.rootFolderName=rootName;
    localStorage.setItem("aa_root_folder_name",rootName);

    // Browsers intentionally do not expose the real Windows absolute path of a
    // folder selected with showDirectoryPicker(). If the displayed root path
    // ended with the previously selected folder name, update that last segment
    // to the newly selected folder name. The user can still enter the exact
    // Windows path manually when the folder is located elsewhere.
    const currentRoot=String(state.rootPath||"").replace(/[\\/]+$/,"");
    const lastPart=currentRoot.split(/[\\/]+/).pop()||"";
    if(previousFolderName && lastPart.toLowerCase()===String(previousFolderName).toLowerCase()){
      state.rootPath=currentRoot.slice(0,currentRoot.length-lastPart.length)+rootName;
      localStorage.setItem("aa_root_path",state.rootPath);
    }

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
  updateRootUI();
  $("folderPath").textContent=state.rootFolderName
    ? `Selected: ${state.rootFolderName} · Copy root: ${state.rootPath}`
    : `Copy root: ${state.rootPath}`;
  toast("Root path updated — COPY PATH will use this path");
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
  renderMotifFilters();
  if("serviceWorker" in navigator && location.protocol!=="file:"){
    navigator.serviceWorker.register("service-worker.js").catch(()=>{});
  }
})();

// Keep the mobile Home/Search controls intentionally lightweight: both open the design search workspace.
