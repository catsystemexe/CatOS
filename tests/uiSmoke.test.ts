import { test, expect } from "vitest";
import { createUiServer } from "../src/uiServer.js";

async function withUiServer<T>(run:(baseUrl:string)=>Promise<T>){
  const server=createUiServer();
  await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
  const addr=server.address();
  const port=typeof addr==="object"&&addr?addr.port:0;
  try{return await run(`http://127.0.0.1:${port}`);} finally{await new Promise<void>(r=>server.close(()=>r()));}
}

test("UI page loads repository-first SETUP without project/profile chrome", async()=>{ await withUiServer(async(baseUrl)=>{ const res=await fetch(`${baseUrl}/`); const html=await res.text(); expect(res.status).toBe(200); expect(html).toContain("SETUP"); expect(html).toContain("Repository"); expect(html).toContain("Base branch"); expect(html).toContain("PR target"); expect(html).toContain("Task"); expect(html).toContain("RUN"); expect(html).toContain("┌─ SETUP"); expect(html).toContain("┌─ OUTPUT"); expect(html).toContain("Repository path"); expect(html).toContain('<script type="module" src="/app.js">'); expect(html).not.toContain("Project status"); expect(html).not.toContain("Profile"); expect(html).not.toContain("Sandbox"); expect(html).not.toContain("F1 Help"); }); });

test("UI JavaScript assets are served from the explicit allowlist", async()=>{ await withUiServer(async(baseUrl)=>{ const app=await fetch(`${baseUrl}/app.js`); expect(app.status).toBe(200); expect(app.headers.get("content-type")).toBe("text/javascript; charset=utf-8"); expect(app.headers.get("content-type")).not.toContain("application/json"); expect(app.headers.get("content-type")).not.toContain("text/html");

  const repositorySelection=await fetch(`${baseUrl}/repositorySelection.js`); const body=await repositorySelection.text(); expect(repositorySelection.status).toBe(200); expect(repositorySelection.headers.get("content-type")).toBe("text/javascript; charset=utf-8"); expect(repositorySelection.headers.get("content-type")).not.toContain("application/json"); expect(repositorySelection.headers.get("content-type")).not.toContain("text/html"); expect(body).toContain("export function findRepository"); expect(body).toContain("export function createBranchLoader"); }); });

test("UI asset routing keeps unknown files and path traversal blocked", async()=>{ await withUiServer(async(baseUrl)=>{ const missing=await fetch(`${baseUrl}/missing.js`); expect(missing.status).toBe(404); const traversal=await fetch(`${baseUrl}/../package.json`); expect(traversal.status).toBe(404); const encodedTraversal=await fetch(`${baseUrl}/%2e%2e/package.json`); expect(encodedTraversal.status).toBe(404); }); });
