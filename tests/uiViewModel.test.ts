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
  expect(html).toContain("No output available yet.");
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
  expect(css).toContain(".execution-panel{display:grid;grid-template-rows:minmax(0,1fr) auto");
  expect(css).toContain(".value-readout{display:block;white-space:normal;overflow-wrap:anywhere;word-break:break-word");
  expect(css).not.toContain("#viewer{");
  expect(css).not.toContain("text-overflow:ellipsis");
  expect(css).not.toContain("text-overflow: ellipsis");
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
  expect(html).toContain("No run started.");
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

test("first available output is auto-selected", async () => {
  const { app } = await uiFiles();
  expect(app).toContain("async function autoSelectOutput()");
  expect(app).toContain("const first=latestOutputs.find(o=>o.contentAvailable); if(first) await view(first.path,true);");
  expect(app).toContain("$('viewerPath').textContent=path");
});

test("RUN and OUTPUT UI hide raw JSON in collapsed details and use generated files", async () => {
  const { app, html, css } = await uiFiles();
  expect(html).toContain('id="technicalDetails"');
  expect(html).toContain('id="errorPanel"');
  expect(html).toContain('id="outputList" class="output-select" hidden');
  expect(app).toContain("latestSystem?.outputs?.length?latestSystem.outputs");
  expect(app).toContain("No readable output file was produced.");
  expect(app).toContain("$('copy').disabled=!res.content");
  expect(app).toContain("async function copyText(text)");
  expect(app).toContain("document.execCommand('copy')");
  expect(app).toContain("rowStep(r){return r.name||r.label||r.type||'Unnamed step';}");
  expect(app).not.toContain("rowStep(r){return r.step||r.name||r.path||r.summary||'step';}");
  expect(html).not.toContain("run-summary");
  expect(html).not.toContain("<table>");
  expect(html).toContain('<div id="timeline" class="timeline-list"');
  expect(html).toContain('<details id="technicalDetails"><summary>Technical details</summary>');
  expect((html.match(/Technical details/g)||[]).length).toBe(1);
  expect(css).toContain(".timeline-row{display:grid;grid-template-columns:3ch minmax(8ch,1fr) 10ch 8ch");
  expect(css).toContain(".timeline-message{grid-column:2 / -1");
  expect(css).toContain(".run-panel{overflow:hidden}");
  expect(css).toContain("#errorDetails,#system{max-height:160px;overflow:auto");
});
