import json,subprocess,tempfile,unittest
from pathlib import Path
from tools.codex_supervisor import APPROVAL,Supervisor
class TestSupervisor(unittest.TestCase):
 def implement(self):
  (self.root/"docs/trackers/ACTIVE.md").write_text("# Active work\n\n## Slice ID\n\nnext\n\n## Acceptance criteria\n\n- documented\n\n## Test-first evidence\n\n- focused test failed then passed.\n")
  (self.root/"worker-change.txt").write_text("implemented\n")
  state=self.root/".codex-supervisor";state.mkdir(exist_ok=True);(state/"worker-result.json").write_text(json.dumps({"status":"completed","outcome":"simulated implementation","acceptance_evidence":["test"],"verification":["focused test"]}))
 def record(self,slice_id):
  completed=self.root/"docs/trackers/COMPLETED.md";completed.write_text(completed.read_text()+f"<!-- slice-id: {slice_id} -->\n**Outcome:** simulated\n**Verification:** simulated\n**Result:** passed\n")
  manifest=self.root/"docs/trackers/WORK_MANIFEST.json";data=json.loads(manifest.read_text())
  for item in data["items"]:
   if item["id"]==slice_id:item.update({"status":"completed","evidence":{"test":"simulated"}})
  manifest.write_text(json.dumps(data))
  (self.root/"docs/trackers/ACTIVE.md").write_text("No active implementation task.\n")
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
  for f in ("README.md","docs/QUALITY_GATES.md","docs/trackers/COMPLETED.md"):
   p=self.root/f;p.parent.mkdir(parents=True,exist_ok=True);p.write_text("\n")
  (self.root/"docs/PLAN.md").write_text("### Sprint 1 — test\n\n- Approved fixture work\n")
  (self.root/"docs/trackers/WORK_MANIFEST.json").write_text(json.dumps({"items":[{"id":"done","status":"completed"},{"id":"next","status":"pending","depends_on":["done"],"plan_reference":"Approved fixture work"},{"id":"then","status":"pending","depends_on":["next"],"plan_reference":"Approved dependent work"},{"id":"unknown","status":"unresolved"}]}))
  (self.root/"docs/trackers/ACTIVE.md").write_text("# Active work\n\nNo active implementation task.\n")
 def tearDown(self):self.tmp.cleanup()
 def test_simulated_workflow_initializes_executes_and_validates(self):
  calls=[]
  def fake(c,**kw):
   calls.append(c)
   if c[0:2]==["codex","exec"]:
    self.implement()
   if c==["git","diff","--quiet"]:return subprocess.CompletedProcess(c,1,"","")
   output="abc\n" if c[0:3]==["git","rev-parse","HEAD"] else "abc\tHEAD\n" if c[0:3]==["git","ls-remote","origin"] else ""
   return subprocess.CompletedProcess(c,0,output,"")
  s=Supervisor(self.root,fake,lambda:100);self.assertIn("DRY RUN",s.once());self.assertEqual(calls,[]);self.assertIn("No active",s.active());self.assertIn("SLICE COMPLETE",s.once(True,APPROVAL));self.assertEqual(calls[0][0:2],["codex","exec"]);self.assertEqual(json.loads((self.root/"docs/trackers/WORK_MANIFEST.json").read_text())["items"][1]["status"],"completed")
 def test_cycle_advances_dependencies_without_human_interaction(self):
  def fake(c,**kw):
   if c[0:2]==["codex","exec"]:
    self.implement()
   if c==["git","diff","--quiet"]:return subprocess.CompletedProcess(c,1,"","")
   output="abc\n" if c[0:3]==["git","rev-parse","HEAD"] else "abc\tHEAD\n" if c[0:3]==["git","ls-remote","origin"] else ""
   return subprocess.CompletedProcess(c,0,output,"")
  results=Supervisor(self.root,fake,lambda:100).cycle(True,APPROVAL);self.assertEqual(len([x for x in results if x.startswith("SLICE COMPLETE")]),2);self.assertIn("all approved",results[-1])
 def test_limits_and_locks_stop_repeated_execution(self):
  s=Supervisor(self.root,lambda c,**kw:subprocess.CompletedProcess(c,1,"",""),lambda:100);s.once();self.assertIn("Codex execution failed",s.once(True,APPROVAL,1));self.assertIn("retry limit",s.once(True,APPROVAL,1))
 def test_unresolved_item_is_not_selected_and_state_survives_restart(self):
  s=Supervisor(self.root,lambda c,**kw:subprocess.CompletedProcess(c,0,"",""),lambda:100);s.once();self.assertIn("No active",s.active());self.assertEqual(Supervisor(self.root).state()["attempts"],{})
 def test_live_lock_prevents_overlapping_execution(self):
  s=Supervisor(self.root,lambda c,**kw:subprocess.CompletedProcess(c,0,"",""),lambda:100);s.once();s.dir.mkdir(exist_ok=True);s.lock.write_text("other")
  self.assertIn("another supervisor execution",s.once(True,APPROVAL))
 def test_missing_tracker_evidence_stops_successful_simulation(self):
  s=Supervisor(self.root,lambda c,**kw:subprocess.CompletedProcess(c,0,"",""),lambda:100);s.once()
  self.assertIn("no valid structured result",s.once(True,APPROVAL))
 def test_timeout_persists_stop_for_restart_recovery(self):
  def timeout(c,**kw):raise subprocess.TimeoutExpired(c,kw["timeout"])
  s=Supervisor(self.root,timeout,lambda:100);s.once();self.assertIn("timed out",s.once(True,APPROVAL));self.assertEqual(Supervisor(self.root).state()["stopped_reason"],"Codex execution timed out")
 def test_quality_gate_timeout_stops_without_manifest_completion(self):
  def fake(c,**kw):
   if c[0:2]==["codex","exec"]:
    self.implement()
   if c==["corepack","pnpm","verify"]:raise subprocess.TimeoutExpired(c,1)
   return subprocess.CompletedProcess(c,0,"","")
  s=Supervisor(self.root,fake,lambda:100);s.once();self.assertIn("quality gate timed out",s.once(True,APPROVAL));self.assertEqual(json.loads((self.root/"docs/trackers/WORK_MANIFEST.json").read_text())["items"][1]["status"],"pending")
 def test_worker_block_is_preserved_without_completion(self):
  def fake(c,**kw):
   if c[0:2]==["codex","exec"]:
    state=self.root/".codex-supervisor";state.mkdir(exist_ok=True);(state/"worker-result.json").write_text(json.dumps({"status":"blocked","outcome":"missing approved routing contract","acceptance_evidence":[],"verification":[],"blocker":"documentation ambiguity"}))
   return subprocess.CompletedProcess(c,0,"","")
  s=Supervisor(self.root,fake,lambda:100);s.once();self.assertIn("worker reported blocker",s.once(True,APPROVAL));self.assertEqual(json.loads((self.root/"docs/trackers/WORK_MANIFEST.json").read_text())["items"][1]["status"],"pending")
if __name__=="__main__":unittest.main()
