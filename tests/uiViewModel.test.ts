import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { createBranchLoader } from "../src/ui/repositorySelection.js";

async function uiFiles(){
  const app = await readFile(new URL("../src/ui/app.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../src/ui/index.html", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/ui/app.css", import.meta.url), "utf8");
  return { app, html, css };
}

test("UI script and markup render GitHub-first checkout controls", async () => {
  const { app, html } = await uiFiles();
  expect(app).toContain("function renderRepositoryOptions(repositories)");
  expect(app).toContain("const gh=repositories.filter(r=>r.source==='github')");
  expect(app).toContain("${esc(r.fullName||r.name)}");
  expect(app).toContain("/api/github/repositories");
  expect(app).toContain("/api/github/clone-branch");
  expect(app).not.toContain("r.source==='github'?(r.fullName||r.name):r.name");
  expect(app).not.toContain("gpt-handoff");
  expect(html).toContain("FINAL_REPORT.md");
  expect(html).toContain("Git repository");
  expect(html).toContain('id="selectedRepositoryName"');
  expect(html).toContain("Local clone");
  expect(html).toContain('id="repositoryPath" class="value-readout"');
  expect(html).toContain("id=\"branch\"");
  expect(html).toContain("Base branch");
  expect(html).toContain('id="baseBranch" class="value-readout inline-readout"');
  expect(html).toContain('id="clone" class="primary"');
  expect(html).toContain("CLONE BRANCH");
  expect(html).toContain('<textarea id="task"></textarea>');
  expect(html).toContain('<button id="run" class="primary" type="button">RUN</button>');
  expect(html).toContain('<button id="stop" type="button" disabled>STOP</button>');
  expect(html).toContain('class="app-layout"');
  expect(html).toContain('class="setup-panel"');
  expect(html).toContain('class="execution-panel"');
  expect(html).toContain("Snapshot:</strong> automatic on RUN");
  expect(html).not.toContain("id=\"refresh\"");
  expect(html).toContain("id=\"copy\"");
  expect(html).toContain("type=\"module\" src=\"/app.js\"");
  expect(html).not.toContain("copyText");
  expect(html).not.toContain("projectStatus");
  expect(html).not.toContain("Project");
  expect(html).not.toContain("Profile");
  expect(html).not.toContain("Sandbox");
  expect(html).not.toContain("PR target");
});

test("repository options use only GitHub repositories and full names", async () => {
  const { app } = await uiFiles();
  expect(app).toContain("window.repositories=res.repositories.filter(r=>r.source==='github')");
  expect(app).toContain("const gh=repositories.filter(r=>r.source==='github')");
  expect(app).toContain("value=\"${esc(r.id)}\"");
  expect(app).toContain("${esc(r.fullName||r.name)}");
  expect(app).toContain("$('selectedRepositoryName').textContent=selectedRepositoryLabel()");
  expect(app).not.toContain("repo.localPath||repo.path||repo.name");
  expect(app).not.toContain("r.source==='github'?(r.fullName||r.name):r.name");
});

test("branch request guard keeps latest repository branches", async () => {
  const catos = { id: "catos", localPath: "/repos/CatOS" };
  const notecat = { id: "notecat", localPath: "/repos/NoteCat" };
  let selected = catos;
  let catosDone: (v: { branches: { name: string }[] }) => void = () => {};
  let notecatDone: (v: { branches: { name: string }[] }) => void = () => {};
  let applied: { base: string; target: string } | undefined;
  const loader = createBranchLoader({
    getSelectedRepository: () => selected,
    fetchBranches: (repoPath) =>
      new Promise<{ branches: { name: string }[] }>((resolve) => {
        if (repoPath.includes("CatOS")) catosDone = resolve;
        else notecatDone = resolve;
      }),
    applyBranches: (branches) => {
      applied = { base: branches[0]?.name || "", target: branches[0]?.name || "" };
    },
    clearBranches: () => {
      applied = { base: "", target: "" };
    },
    setError: () => {},
  });
  const old = loader.load(catos);
  selected = notecat;
  const current = loader.load(notecat);
  notecatDone({ branches: [{ name: "notecat-main" }] });
  await current;
  catosDone({ branches: [{ name: "catos-main" }] });
  await old;
  expect(applied).toEqual({ base: "notecat-main", target: "notecat-main" });
});

test("frontend clone flow sends selected branch to clone endpoint", async () => {
  const { app } = await uiFiles();
  expect(app).toContain("repositoryRequestVersion");
  expect(app).toContain("checkout=null");
  expect(app).toContain("/api/github/repositories");
  expect(app).toContain("/api/github/branches?repositoryId=");
  expect(app).toContain("/api/github/clone-branch");
  expect(app).toContain("body:JSON.stringify({repositoryId:repo.id,branch:$('branch').value})");
  expect(app).not.toContain("branch:$('base').value");
});

test("frontend clone flow stores checkout response without repository refresh", async () => {
  const { app } = await uiFiles();
  expect(app).toContain("checkout=res.checkout");
  expect(app).not.toContain("await loadRepositories(res.repository)");
  expect(app).not.toContain("Cloned repository was not found after refresh.");
});

test("RUN enablement requires checkout and task", async () => {
  const { app } = await uiFiles();
  expect(app).toContain("const ready=!!checkout&&!!checkout.localPath&&!!checkout.branch&&!!$('task').value.trim()&&!activeStopPhases.has(phase)");
  expect(app).toContain("$('run').disabled=!ready");
  expect(app).toContain("if(!checkout)throw new Error('RUN requires a cloned branch checkout.')");
  expect(app).toContain("repositoryPath:checkout.localPath");
  expect(app).toContain("baseBranch:checkout.branch");
  expect(app).toContain("prTargetBranch:checkout.branch");
});

test("layout keeps actions visible, wraps long values, and prevents page scrolling", async () => {
  const { css } = await uiFiles();
  expect(css).toContain("html,body{width:100%;height:100%;margin:0}");
  expect(css).toContain("body{display:grid;grid-template-rows:auto minmax(0,1fr);overflow:hidden");
  expect(css).toContain("main{min-height:0;overflow:hidden}");
  expect(css).toContain(".app-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr)");
  expect(css).toContain(".setup-panel{border:1px solid #000;padding:6px;display:grid;grid-template-rows:auto auto auto auto minmax(90px,1fr) auto auto");
  expect(css).toContain(
    ".execution-panel{display:grid;grid-template-rows:auto minmax(0,1fr)"
  );
  expect(css).toContain(".value-readout{display:block;white-space:normal;overflow-wrap:anywhere;word-break:break-word");
  expect(css).not.toContain("#viewer{");
  expect(css).toContain(".value-readout{display:block;white-space:normal;overflow-wrap:anywhere;word-break:break-word");
  expect(css).not.toContain(".value-readout{display:block;white-space:nowrap");
  expect(css).toContain("#viewerTitle{min-width:0;white-space:normal;overflow-wrap:anywhere;word-break:break-word");
});

test("CLONE uses a compact primary button, not full-width input styling", async () => {
  const { css, html } = await uiFiles();
  expect(html).toContain('id="clone" class="primary"');
  expect(css).toContain("button.primary{width:auto;padding:4px 12px;border:2px solid #000;background:#000;color:#fff;font-weight:bold}");
});

test("RUN state model starts first and only shows running after a valid runId", async () => {
  const { app } = await uiFiles();
  expect(app).toContain("setPhase('starting','Creating run snapshot…')");
  expect(app).toContain("if(!res.runId){runId=''; $('runNo').textContent='RUN #-'; setPhase('failed','Run was not created.'); return;}");
  expect(app).toContain("runId=res.runId");
  expect(app).toContain("setPhase('running','Waiting for first timeline event…')");
});

test("RUN timeline shows empty and polling error states without empty catch", async () => {
  const { app, html } = await uiFiles();
  expect(app).toContain("Waiting for first timeline event…");
  expect(app).toContain("Timeline unavailable: ${safeMessage(e)}");
  expect(app).not.toContain("catch{}");
});

test("STOP is phase-driven and terminal states do not return to running", async () => {
  const { app } = await uiFiles();
  expect(app).toContain("const activeStopPhases=new Set(['starting','running','stopping'])");
  expect(app).toContain("$('stop').disabled=!activeStopPhases.has(phase)");
  expect(app).toContain("if(terminalPhases.has(phase)&&next==='running')return");
});

test("VIEW exposes one COPY button and no OUTPUT panel", async () => {
  const { app, html } = await uiFiles();
  expect(html).not.toContain('<section class="output-panel">');
  expect(html).toContain('id="copy" type="button" disabled>COPY');
  expect(html).not.toContain('id="download"');
  expect(app).toContain("viewContent");
  expect(app).not.toContain("async function autoSelectOutput()");
  expect(app).not.toContain("viewerPath");
});

test("RUN and VIEW UI hide raw JSON and obsolete controls", async () => {
  const { app, html, css } = await uiFiles();
  expect(html).not.toContain('id="technicalDetails"');
  expect(html).not.toContain('id="errorPanel"');
  expect(html).not.toContain('id="outputList"');
  expect(html).not.toContain('viewerPath');
  expect(html).not.toContain('Technical details');
  expect(html).not.toContain('session report');
  expect(app).not.toContain("$('system')");
  expect(app).not.toContain("outputList");
  expect(app).toContain("data-step-path");
  expect(app).toContain("const available=!!rf?.exists&&!!rf?.readable&&!!rf?.path");
  expect(app).toContain("report-action ${available?'copy-available':'copy-unavailable'}");
  expect(html).not.toContain("<table>");
  expect(html).toContain('<div id="timeline" class="timeline-list"');
  expect(css).toContain(".timeline-row{display:grid;grid-template-columns:24px minmax(100px,1fr) 100px 64px 90px");
  expect(css).toContain(".report-action");
});

test("reports preserve slash prose and redact absolute workspace paths", async()=>{ const f=await fixture(); await writeBase(f,"ACCEPT","PASS"); await writeFile(path.join(f.attemptDir,"review-report.json"),JSON.stringify({schemaVersion:1,verdict:"ACCEPT",summary:"workspace diff/status input/output file/path docs/AUTOCODEX_E2E_TEST.md /tmp/secret/workspace",reviewedAcceptanceCriteria:[{criterion:"file exists",status:"SATISFIED",evidence:"ok"}],blockingFindings:[],warnings:[]})); await writeSessionReport(f.runDir); const md=await readFile(path.join(f.runDir,"03_REVIEW_REPORT.md"),"utf8"); expect(md).toContain("workspace diff/status input/output file/path docs/AUTOCODEX_E2E_TEST.md"); expect(md).not.toContain("/tmp/secret/workspace"); expect(md).toContain("<path>"); });

test("REVIEW report separates expected files from acceptance criteria", async()=>{ const f=await fixture(); await writeBase(f,"ACCEPT","PASS"); await writeFile(path.join(f.attemptDir,"task-brief.json"),JSON.stringify({acceptanceCriteria:["file exists","content matches","only expected file changed","git diff --check passes"],expectedFiles:["docs/AUTOCODEX_E2E_TEST.md"]})); await writeSessionReport(f.runDir); const md=await readFile(path.join(f.runDir,"03_REVIEW_REPORT.md"),"utf8"); expect(md).toContain("## Expected files\n- docs/AUTOCODEX_E2E_TEST.md"); expect(md).toContain("## Acceptance criteria\n- file exists\n- content matches"); });

test("FINAL report separates repository, selected base branch, and run branch", async()=>{ const f=await fixture(); await writeBase(f,"ACCEPT","PASS"); await writeFile(path.join(f.runDir,"session.json"),JSON.stringify({schemaVersion:1,runId:"run-1",sessionId:"run-1",goal:"task",status:"active",branch:"catos/run-1",workspacePath:f.ws,git:{remoteUrl:"https://github.com/catsystemexe/CatOS.git",baseBranch:"autocodex",runBranch:"catos/run-1"},createdAt:"2026-07-14T00:00:00.000Z",updatedAt:"2026-07-14T00:00:01.000Z",steps:["step"],activeStepId:"step"})); await writeFinalResult(f.runDir,{schemaVersion:1,runId:"run-1",status:"ACCEPTED",terminalMessage:"TASK COMPLETE",error:null,finalReviewVerdict:"ACCEPT",totalCodingAttempts:1,reworkAttempts:0,finalWorkspacePath:f.ws,finalChangedFiles:[],finalValidationStatus:"PASS",finalReviewReportPath:path.join(f.attemptDir,"review-report.json"),outputs:[]}); const md=await readFile(path.join(f.runDir,"FINAL_REPORT.md"),"utf8"); expect(md).toContain("- repository: catsystemexe/CatOS"); expect(md).toContain("- selected base branch: autocodex"); expect(md).toContain("- run branch: catos/run-1"); });
