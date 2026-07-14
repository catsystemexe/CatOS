import { test, expect } from "vitest";
import { createUiServer } from "../src/uiServer.js";

async function withUiServer<T>(run:(baseUrl:string)=>Promise<T>){
  const server=createUiServer();
  await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
  const addr=server.address();
  const port=typeof addr==="object"&&addr?addr.port:0;
  try{return await run(`http://127.0.0.1:${port}`);} finally{await new Promise<void>(r=>server.close(()=>r()));}
}

test("UI page renders the two-panel repository-first AutoCodex layout", async()=>{ await withUiServer(async(baseUrl)=>{ const res=await fetch(`${baseUrl}/`); const html=await res.text(); expect(res.status).toBe(200); expect(html).toContain("SETUP"); expect(html).toContain("Git repository"); expect(html).toContain('id="selectedRepositoryName"'); expect(html).toContain("Branch"); expect(html).toContain("Base branch"); expect(html).not.toContain("PR target"); expect(html).toContain("Task"); expect(html).toContain("RUN"); expect(html).toContain("OUTPUT"); expect(html).toContain("Local clone"); expect(html).toContain('id="clone" class="primary"'); expect(html).toContain("CLONE BRANCH"); expect(html).toContain('id="repositoryPath" class="value-readout"'); expect(html).toContain('id="baseBranch" class="value-readout inline-readout"'); expect(html).toContain('<textarea id="task"></textarea>'); expect(html).toContain('<button id="run" class="primary" type="button">RUN</button>'); expect(html).toContain('<button id="stop" type="button" disabled>STOP</button>'); expect(html).toContain('class="app-layout"'); expect(html).toContain('class="setup-panel"'); expect(html).toContain('class="execution-panel"'); expect(html).toContain("No run started."); expect(html).toContain("No output available yet."); expect(html).toContain('<script type="module" src="/app.js">'); expect(html).not.toContain("Project status"); expect(html).not.toContain("Profile"); expect(html).not.toContain("Sandbox"); expect(html).not.toContain("F1 Help"); }); });

test("RUN and STOP are after Task and outside the textarea DOM", async()=>{ await withUiServer(async(baseUrl)=>{ const html=await (await fetch(`${baseUrl}/`)).text(); const taskIndex=html.indexOf('id="task"'); const runReasonIndex=html.indexOf('id="runReason"'); const runIndex=html.indexOf('id="run"'); const stopIndex=html.indexOf('id="stop"'); expect(taskIndex).toBeGreaterThan(-1); expect(runReasonIndex).toBeGreaterThan(taskIndex); expect(runIndex).toBeGreaterThan(runReasonIndex); expect(stopIndex).toBeGreaterThan(runIndex); const textareaClose=html.indexOf('</textarea>', taskIndex); expect(runIndex).toBeGreaterThan(textareaClose); }); });

test("page layout exposes only SETUP and execution as main panels", async()=>{ await withUiServer(async(baseUrl)=>{ const html=await (await fetch(`${baseUrl}/`)).text(); const main=html.slice(html.indexOf('<main'), html.indexOf('</main>'));
    expect((main.match(/<section class="setup-panel">/g)||[])).toHaveLength(1);
    expect((main.match(/<section class="execution-panel">/g)||[])).toHaveLength(1);
    expect(main).not.toContain('setup-window');
    expect(main).not.toContain('execution-window');
  }); });

test("UI JavaScript assets are served from the explicit allowlist", async()=>{ await withUiServer(async(baseUrl)=>{ const app=await fetch(`${baseUrl}/app.js`); expect(app.status).toBe(200); expect(app.headers.get("content-type")).toBe("text/javascript; charset=utf-8"); expect(app.headers.get("content-type")).not.toContain("application/json"); expect(app.headers.get("content-type")).not.toContain("text/html");
  const repositorySelection=await fetch(`${baseUrl}/repositorySelection.js`); const body=await repositorySelection.text(); expect(repositorySelection.status).toBe(200); expect(repositorySelection.headers.get("content-type")).toBe("text/javascript; charset=utf-8"); expect(body).toContain("export function findRepository"); expect(body).toContain("export function createBranchLoader"); }); });

test("UI asset routing keeps unknown files and path traversal blocked", async()=>{ await withUiServer(async(baseUrl)=>{ const missing=await fetch(`${baseUrl}/missing.js`); expect(missing.status).toBe(404); const traversal=await fetch(`${baseUrl}/../package.json`); expect(traversal.status).toBe(404); const encodedTraversal=await fetch(`${baseUrl}/%2e%2e/package.json`); expect(encodedTraversal.status).toBe(404); }); });
