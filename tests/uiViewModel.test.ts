import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { createBranchLoader } from "../src/ui/repositorySelection.js";

test("UI script and markup render GitHub-first checkout controls", async () => {
  const app = await readFile(new URL("../src/ui/app.js", import.meta.url), "utf8");
  expect(app).toContain("function renderRepositoryOptions(repositories)");
  expect(app).toContain("const gh=repositories.filter(r=>r.source==='github')");
  expect(app).toContain("${esc(r.fullName||r.name)}");
  expect(app).toContain("/api/github/repositories");
  expect(app).toContain("/api/github/clone-branch");
  expect(app).not.toContain("r.source==='github'?(r.fullName||r.name):r.name");
  expect(app).not.toContain("gpt-handoff");

  const html = await readFile(new URL("../src/ui/index.html", import.meta.url), "utf8");
  expect(html).toContain("No output selected");
  expect(html).toContain("Git repository");
  expect(html).toContain("Local clone");
  expect(html).toContain("<input id=\"repositoryPath\" readonly>");
  expect(html).toContain("id=\"branch\"");
  expect(html).toContain("Base branch");
  expect(html).toContain("<input id=\"baseBranch\" readonly>");
  expect(html).toContain("id=\"clone\"");
  expect(html).toContain("<textarea id=\"task\"></textarea>");
  expect(html).toContain("<button id=\"run\" type=\"button\">RUN</button>");
  expect(html).toContain("<button id=\"stop\" type=\"button\" disabled>STOP</button>");
  expect(html).toContain("class=\"app-layout\"");
  expect(html).toContain("class=\"setup-window\"");
  expect(html).toContain("class=\"execution-window\"");
  expect(html).toContain("Snapshot: created automatically for each RUN.");
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
  const app = await readFile(new URL("../src/ui/app.js", import.meta.url), "utf8");
  expect(app).toContain("window.repositories=res.repositories.filter(r=>r.source==='github')");
  expect(app).toContain("const gh=repositories.filter(r=>r.source==='github')");
  expect(app).toContain("value=\"${esc(r.id)}\"");
  expect(app).toContain("${esc(r.fullName||r.name)}");
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
  const app = await readFile(new URL("../src/ui/app.js", import.meta.url), "utf8");
  expect(app).toContain("repositoryRequestVersion");
  expect(app).toContain("checkout=null");
  expect(app).toContain("/api/github/repositories");
  expect(app).toContain("/api/github/branches?repositoryId=");
  expect(app).toContain("/api/github/clone-branch");
  expect(app).toContain("body:JSON.stringify({repositoryId:repo.id,branch:$('branch').value})");
  expect(app).not.toContain("branch:$('base').value");
});

test("frontend clone flow stores checkout response without repository refresh", async () => {
  const app = await readFile(new URL("../src/ui/app.js", import.meta.url), "utf8");
  expect(app).toContain("checkout=res.checkout");
  expect(app).not.toContain("await loadRepositories(res.repository)");
  expect(app).not.toContain("Cloned repository was not found after refresh.");
});

test("frontend clone flow stores checkout response and uses it for RUN", async () => {
  const app = await readFile(new URL("../src/ui/app.js", import.meta.url), "utf8");
  expect(app).toContain("const ready=!!checkout&&!!checkout.localPath&&!!checkout.branch&&!!$('task').value.trim()");
  expect(app).toContain("$('run').disabled=!ready");
  expect(app).toContain("if(!checkout)throw new Error('RUN requires a cloned branch checkout.')");
  expect(app).toContain("repositoryPath:checkout.localPath");
  expect(app).toContain("baseBranch:checkout.branch");
  expect(app).toContain("prTargetBranch:checkout.branch");
});


test("MVP checkout UI keeps branch visible, resets checkout on selection changes, and avoids ellipsis path truncation", async () => {
  const app = await readFile(new URL("../src/ui/app.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/ui/app.css", import.meta.url), "utf8");
  expect(app).toContain("$('branchStatus').textContent='Loading branches...'");
  expect(app).toContain("$('branch').innerHTML='<option value=\"\">No branches available</option>'");
  expect(app).toContain("function clearCheckout(){checkout=null; $('repositoryPath').value='not cloned'; $('baseBranch').value='-';}");
  expect(app).toContain("$('repository').onchange=async()=>{clearCheckout(); await loadBranches(selectedRepository());}");
  expect(app).toContain("$('branch').onchange=()=>{clearCheckout(); updateRepositoryState();}");
  expect(css).toContain("html,body{width:100%;height:100%;margin:0}");
  expect(css).toContain("body{display:grid;grid-template-rows:auto minmax(0,1fr);overflow:hidden");
  expect(css).toContain("main{min-height:0;overflow:hidden}");
  expect(css).toContain(".app-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr)");
  expect(css).toContain("#repositoryPath,#baseBranch");
  expect(css).toContain("overflow-x:auto");
  expect(css).toContain("white-space:nowrap");
  expect(css).toContain("text-overflow:clip");
  expect(css).not.toContain("text-overflow:ellipsis");
  expect(css).not.toContain("text-overflow: ellipsis");
  expect(css).not.toContain("overflow:hidden;text-overflow:ellipsis");
});
