#!/usr/bin/env python3
"""Inactive-by-default, restart-safe supervisor for documented Codex slices."""
from __future__ import annotations
import argparse, json, os, re, subprocess, time
from pathlib import Path

APPROVAL="I_APPROVE_UNATTENDED_CODEX_SUPERVISOR"; DOCS=("README.md","docs/PLAN.md","docs/QUALITY_GATES.md","docs/trackers/ACTIVE.md","docs/trackers/COMPLETED.md")
GATES=(("quality",["corepack","pnpm","verify"]),("diff",["git","diff","--check"]))

class Supervisor:
 def __init__(self,root,executor=subprocess.run,now=time.time): self.root=Path(root).resolve();self.exec=executor;self.now=now;self.dir=self.root/".codex-supervisor";self.statefile=self.dir/"state.json";self.lock=self.dir/"lock"
 def read(self,p): return (self.root/p).read_text(encoding="utf8")
 def state(self): return json.loads(self.statefile.read_text()) if self.statefile.exists() else {"attempts":{},"history":[],"stopped_reason":None}
 def save(self,s): self.dir.mkdir(exist_ok=True);self.statefile.write_text(json.dumps(s,indent=2)+"\n")
 def backlog(self): return json.loads(self.read("docs/trackers/WORK_MANIFEST.json"))["items"]
 def write_backlog(self):
  p=self.root/"docs/trackers/BACKLOG.json"; p.write_text(json.dumps({"source":"docs/trackers/WORK_MANIFEST.json","slices":self.backlog()},indent=2)+"\n");return p
 def active(self): return self.read("docs/trackers/ACTIVE.md")
 def initialize(self,write=True):
  active=self.active()
  if "No active implementation task." not in active:return active
  items=self.backlog(); completed={x["id"] for x in items if x["status"]=="completed"}
  item=next((x for x in items if x["status"]=="pending" and set(x.get("depends_on",[]))<=completed),None)
  if not item:return None
  text=f"# Active work\n\n## Slice ID\n\n{item['id']}\n\n## Next task\n\n{item['plan_reference']}\n\n## Acceptance criteria\n\n- Derive only from cited approved documentation, ADRs, and existing code contracts.\n- Record test-first evidence and all quality-gate results before completion.\n- No production-system, secret, deployment, or undocumented architecture change.\n\n## Test-first evidence\n\n- Pending.\n";
  if write:(self.root/"docs/trackers/ACTIVE.md").write_text(text)
  return text
 def call(self,c): return self.exec(c,cwd=self.root,text=True,capture_output=True,check=False,timeout=1800)
 def append_history(self,event):
  with (self.root/"docs/trackers/SUPERVISOR_HISTORY.jsonl").open("a",encoding="utf8") as f:f.write(json.dumps(event,sort_keys=True)+"\n")
 def acquire_lock(self,stale_seconds):
  self.dir.mkdir(exist_ok=True)
  if self.lock.exists() and self.now()-self.lock.stat().st_mtime>=stale_seconds:self.lock.unlink()
  try:
   self.lock_token=f"{os.getpid()}:{self.now()}";fd=os.open(self.lock,os.O_CREAT|os.O_EXCL|os.O_WRONLY);os.write(fd,self.lock_token.encode());os.close(fd);return True
  except FileExistsError:return False
 def once(self,activate=False,ack=None,max_attempts=2,stale_seconds=3600):
  for d in DOCS:
   if not (self.root/d).is_file():return f"STOP: missing required document: {d}"
  self.write_backlog(); active=self.active()
  if "No active implementation task." in active:
   if not activate:
    return "DRY RUN: next eligible manifest slice identified; Codex and project trackers were not modified."
  if ack!=APPROVAL:return "STOP: explicit activation acknowledgement required."
  if not self.acquire_lock(stale_seconds):return "STOP: another supervisor execution is active."
  try:
   active=self.initialize() if "No active implementation task." in active else active
   if not active:return "STOP: all approved work complete."
   s=self.state(); slice_id=re.search(r"## Slice ID\s+([^\n]+)",active).group(1).strip()
   if s["attempts"].get(slice_id,0)>=max_attempts:return "STOP: retry limit reached; human review required."
   s["attempts"][slice_id]=s["attempts"].get(slice_id,0)+1;self.save(s);self.append_history({"event":"started","slice":slice_id,"at":self.now()})
   result_path=self.dir/"worker-result.json"
   prompt="Read AGENTS.md and all required docs. Implement only ACTIVE.md. Follow test-first gates. Never deploy, change production, create secrets, bypass validation, or invent requirements. Update ACTIVE.md with acceptance criteria and test-first evidence, but do not finalize trackers, commit, or push: the supervisor owns lifecycle finalization. Your final structured result must report completed or blocked, with evidence. Stop for ambiguity or required authority.\n\n"+active
   try: result=self.call(["codex","exec","--sandbox","workspace-write","--output-schema",str(self.root/"tools/schemas/worker-result.json"),"--output-last-message",str(result_path),"--json","--cd",str(self.root),prompt])
   except subprocess.TimeoutExpired:return self.stop(s,"Codex execution timed out")
   if result.returncode:return self.stop(s,"Codex execution failed")
   try: worker=json.loads(result_path.read_text())
   except (OSError,json.JSONDecodeError):return self.stop(s,"worker produced no valid structured result")
   if worker["status"]=="blocked":return self.stop(s,"worker reported blocker: "+worker.get("blocker",worker["outcome"]))
   if not worker["acceptance_evidence"] or not worker["verification"]:
    return self.stop(s,"worker result lacks completion evidence")
   updated=self.active()
   if "Pending" in updated or updated==active:
    return self.stop(s,"worker did not record completion-ready acceptance evidence")
   for name,c in GATES:
    try: gate=self.call(c)
    except subprocess.TimeoutExpired:return self.stop(s,f"quality gate timed out: {name}")
    if gate.returncode:return self.stop(s,f"quality gate failed: {name}")
   if self.call(["git","diff","--quiet"]).returncode==0:
    return self.stop(s,"worker produced no change to validate")
   self.finalize(slice_id,updated,worker)
   try:
    if self.call(["git","add","-A"]).returncode:return self.stop(s,"git staging failed")
    if self.call(["git","commit","-m",f"feat: complete {slice_id}"]).returncode:return self.stop(s,"git commit failed")
    if self.call(["git","push","origin","main"]).returncode:return self.stop(s,"git push failed")
    clean=self.call(["git","status","--porcelain"]);head=self.call(["git","rev-parse","HEAD"]);remote=self.call(["git","ls-remote","origin","HEAD"])
   except subprocess.TimeoutExpired:return self.stop(s,"commit/push verification timed out")
   if clean.returncode or clean.stdout.strip() or head.returncode or remote.returncode or not remote.stdout.startswith(head.stdout.strip()):
    return self.stop(s,"required commit and push verification failed")
   s["history"].append({"slice":slice_id,"completed_at":self.now()});s["stopped_reason"]=None;self.save(s);self.append_history({"event":"completed","slice":slice_id,"at":self.now()});return "SLICE COMPLETE: re-run selects next eligible slice."
  finally:
   if self.lock.exists() and self.lock.read_text()==getattr(self,"lock_token",None):self.lock.unlink()
 def stop(self,s,reason): s["stopped_reason"]=reason;self.save(s);self.append_history({"event":"stopped","reason":reason,"at":self.now()});return "STOP: "+reason+"; human review required."
 def finalize(self,slice_id,active,worker):
  completed=self.root/"docs/trackers/COMPLETED.md"
  completed.write_text(completed.read_text()+f"\n<!-- slice-id: {slice_id} -->\n\n**Outcome:** {worker['outcome']}\n\n**Verification:** {'; '.join(worker['verification'])}; supervisor gates passed.\n\n**Result:** passed.\n")
  manifest=json.loads(self.read("docs/trackers/WORK_MANIFEST.json"))
  for item in manifest["items"]:
   if item["id"]==slice_id:item.update({"status":"completed","evidence":{"supervisor":"worker evidence plus quality gates","completed_at":self.now()}})
  (self.root/"docs/trackers/WORK_MANIFEST.json").write_text(json.dumps(manifest,indent=2)+"\n")
  (self.root/"docs/trackers/ACTIVE.md").write_text("# Active work\n\nNo active implementation task. The supervisor must select the next eligible manifest slice before changing application code.\n")
 def cycle(self,activate=False,ack=None,max_attempts=2,max_slices=20):
  results=[]
  for _ in range(max_slices):
   result=self.once(activate,ack,max_attempts);results.append(result)
   if not result.startswith("SLICE COMPLETE"): return results
  return results+["STOP: maximum slices reached; human review required."]
def main(argv=None):
 p=argparse.ArgumentParser();p.add_argument("--root",type=Path,default=Path.cwd());p.add_argument("--run",action="store_true");p.add_argument("--acknowledgement");p.add_argument("--max-attempts",type=int,default=2);p.add_argument("--max-slices",type=int,default=20);a=p.parse_args(argv);print("\n".join(Supervisor(a.root).cycle(a.run,a.acknowledgement,a.max_attempts,a.max_slices)))
if __name__=="__main__":main()
