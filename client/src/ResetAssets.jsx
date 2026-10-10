import React,{useEffect,useState} from 'react';
import {api} from './api';
export default function ResetAssets({branches,onClose,onDone}){
 const [branch,setBranch]=useState(branches[0]?.id||''),[preview,setPreview]=useState(null),[history,setHistory]=useState([]),[downloaded,setDownloaded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[confirmation,setConfirmation]=useState(''),[password,setPassword]=useState(''),[reason,setReason]=useState(''),[restore,setRestore]=useState(null);
 const [protection,setProtection]=useState(null),[protecting,setProtecting]=useState(false),[through,setThrough]=useState(''),[protectionLoaded,setProtectionLoaded]=useState(false);
 const name=branches.find(b=>b.id===branch)?.name||'';
 useEffect(()=>{let live=true;setPreview(null);setRestore(null);setDownloaded(false);setProtection(null);setProtecting(false);setProtectionLoaded(false);api('/branches/'+branch+'/reset-protection').then(r=>{if(live){setProtection(r);setProtectionLoaded(true);}}).catch(e=>{if(live)setError(e.message);});setConfirmation('');setPassword('');setError('');setHistory([]);api('/asset-resets?branch='+branch).then(r=>{if(live)setHistory(r);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[branch]);
 const run=async fn=>{setBusy(true);setError('');try{await fn();}catch(e){setError(e.message);}finally{setBusy(false);}};
 const backup=async id=>{const response=await fetch('/api/asset-resets/'+id+'/backup',{credentials:'same-origin'});if(!response.ok)throw Error((await response.json()).error||'Backup download failed');const blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`Moolai-${name}-reset-${id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 return <section className="panel" aria-label="Reset branch assets">
  <div className="panel-h"><h2>Reset branch assets</h2><button className="btn" disabled={busy} onClick={onClose}>Close reset</button></div>
  <p>Exceptional operation: use reset only for an initial setup or a reviewed replacement. For routine corrections, edit the asset or use Correct classification / donor on its schedule. Start one branch with an empty asset register, then upload its Excel sheet. Accounts, dropdown settings, the other branch and audit history remain.</p>
  <p>Existing assets (including previously deleted records), depreciation schedules and deletion requests are removed from this branch. Numbering restarts at 1. Old import previews will no longer work.</p>
  <label>Branch to reset <select value={branch} disabled={busy} onChange={e=>setBranch(e.target.value)}>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
  {!restore&&!protection&&!protecting&&<button className="btn" disabled={busy||!protectionLoaded} onClick={()=>run(async()=>{setPreview(null);setDownloaded(false);setConfirmation('');setPassword('');setPreview(await api('/branches/'+branch+'/reset-preview',{method:'POST'}));})}>Prepare reset backup</button>}
  {protection&&<p role="status"><b>Reset blocked: approved records through {String(protection.approved_through).slice(0,10)}.</b> Use an audited asset correction or a reviewed migration. There is no routine unprotect button.</p>}
  {!preview&&!restore&&!protection&&!protecting&&<button className="btn" disabled={busy||!protectionLoaded} onClick={()=>{setProtecting(true);setConfirmation('');setPassword('');setReason('');}}>Protect approved records from reset</button>}
  {protecting&&<form onSubmit={e=>{e.preventDefault();void run(async()=>{await api('/branches/'+branch+'/reset-protection',{method:'POST',body:{approved_through:through,confirmation,password,reason}});setPassword('');setProtection({approved_through:through});setProtecting(false);});}}>
   <p>Record that this branch's figures have been approved. This permanently disables routine reset for this branch, including existing reset previews. It does not lock ordinary financial edits or replace a full accounting-period close.</p>
   <label>Approved through<input type="date" required value={through} onChange={e=>setThrough(e.target.value)}/></label>
   <label>Type PROTECT {name}<input required value={confirmation} onChange={e=>setConfirmation(e.target.value)}/></label>
   <label>Administrator password<input type="password" required autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/></label>
   <label>Approval reference / reason<input required maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label>
   <button className="btn" disabled={busy||confirmation!==`PROTECT ${name}`} type="submit">Confirm reset protection</button>
   <button className="btn" type="button" disabled={busy} onClick={()=>setProtecting(false)}>Cancel protection</button>
  </form>}
  {preview&&!restore&&<div className="calc"><p><b>{name}: {preview.count} active assets, {preview.storedCount} stored assets.</b> Prepare again if anyone changes the branch before confirmation.</p><button className="btn" disabled={busy} onClick={()=>run(async()=>{await backup(preview.id);setDownloaded(true);})}>Download reset backup</button><p>This JSON archive contains this branch's records, not a full MySQL backup. Keep a full MySQL backup separately. The app also retains a recovery copy in the database.</p></div>}
  {(preview||restore)&&<form onSubmit={e=>{e.preventDefault();void run(async()=>{const id=restore?.id||preview.id;await api('/asset-resets/'+id+(restore?'/restore':'/commit'),{method:'POST',body:{confirmation,password,reason}});setPassword('');onDone(branch,!!restore);});}}>
   {restore&&<p>Restore the saved records for {name}. This works only while the branch is still empty and before any new assets have been added.</p>}
   <div className="form-grid"><label>Type {restore?'RESTORE':'RESET'} {name}<input required autoComplete="off" value={confirmation} onChange={e=>setConfirmation(e.target.value)}/></label><label>Administrator password<input type="password" required autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/></label><label>Reason<input required maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label></div>
   {!restore&&<label style={{display:"flex",alignItems:"center",gap:8}}><input style={{width:"auto",margin:0}} type="checkbox" required disabled={!downloaded} /> I have saved the backup and understand that {name}'s current assets will be cleared.</label>}
   <p><button className="btn danger" disabled={busy||(!restore&&!downloaded)||confirmation!==`${restore?'RESTORE':'RESET'} ${name}`} type="submit">{busy?'Working…':restore?'Restore saved assets':'Reset selected branch'}</button></p>
  </form>}
  {error&&<p className="note" role="alert">{error}</p>}
  {!preview&&!restore&&!protecting&&!protection&&history.some(r=>r.status==='completed')&&<div><h3>Recovery</h3><p>Restore the latest reset only before uploading or adding new assets.</p>{history.filter(r=>r.status==='completed').slice(0,1).map(r=><div key={r.id}><p>{r.storedCount} saved assets · {new Date(r.completedAt).toLocaleString()}</p><button className="btn" disabled={busy} onClick={()=>run(()=>backup(r.id))}>Download saved backup</button><button className="btn" disabled={busy} onClick={()=>{setRestore(r);setConfirmation('');setPassword('');}}>Restore last reset</button></div>)}</div>}
 </section>;
}

