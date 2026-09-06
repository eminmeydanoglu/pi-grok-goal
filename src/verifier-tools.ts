import { Type } from "@sinclair/typebox";
import { realpathSync } from "node:fs";
import { resolve, relative } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const Params = Type.Object({argv:Type.Array(Type.String({minLength:1,maxLength:512}),{minItems:1,maxItems:32}),cwd:Type.Optional(Type.String({maxLength:1024}))},{additionalProperties:false});
const ALLOWED = new Set(["node","npm","npx","git","python","python3","pytest","cargo"]);
const VERIFIER_NETWORK_ENV="PI_GOAL_VERIFIER_NETWORK";

/** Network access is exceptional for independent verification: opt in explicitly. */
export function verifierNetworkEnabled(env:NodeJS.ProcessEnv=process.env){return env[VERIFIER_NETWORK_ENV]==="1";}

export function verifierBubblewrapArgs(requested:string,executable:string,args:string[],shareNetwork=verifierNetworkEnabled()){
  const mounts=["--die-with-parent","--unshare-all"];
  if(shareNetwork)mounts.push("--share-net");
  return[...mounts,"--ro-bind","/","/","--dev","/dev","--proc","/proc","--tmpfs","/tmp","--chdir",requested,"--",executable,...args];
}

export function sandboxPreflightError(platform=process.platform){
  return platform==="linux"?undefined:"Bubblewrap verifier and worker sandboxes require Linux. Install and run Pi on Linux, then retry.";
}

function unavailable(error:unknown){
  const detail=error instanceof Error?error.message:String(error);
  return `Bubblewrap sandbox could not start. Install bwrap and ensure unprivileged user namespaces are permitted; run verifier_sandbox_doctor for a precise preflight result. (${detail})`;
}

export default function verifierTools(pi: ExtensionAPI) {
  pi.on("tool_call",(event,ctx)=>{
    if(event.toolName!=="edit"&&event.toolName!=="write")return;
    const raw=(event.input as {path?:unknown;file_path?:unknown}).path??(event.input as {file_path?:unknown}).file_path;
    if(typeof raw!=="string")return;
    const rel=relative(resolve(ctx.cwd),resolve(ctx.cwd,raw));
    if(rel===".git"||rel.startsWith(`.git/`)||rel.startsWith(`.git\\`))return{block:true,reason:"Worker policy forbids modifying Git metadata",terminate:false};
  });
  pi.registerTool({name:"verifier_sandbox_doctor",label:"Verifier sandbox doctor",description:"Check that the Linux Bubblewrap namespace required by verifier and worker commands can start. This performs no workspace mutation.",parameters:Type.Object({},{additionalProperties:false}),
    execute:async(_id,_params,signal)=>{
      const platformError=sandboxPreflightError();
      if(platformError)return{content:[{type:"text" as const,text:platformError}],details:{},isError:true};
      try{
        const result=await pi.exec("bwrap",["--die-with-parent","--unshare-all","--ro-bind","/","/","--dev","/dev","--proc","/proc","--tmpfs","/tmp","--","/bin/true"],{signal,timeout:15_000});
        const output=`${result.stdout}${result.stderr}`.trim();
        if(result.code!==0)return{content:[{type:"text" as const,text:`Bubblewrap sandbox preflight failed (exit=${result.code}). ${output || "Install bwrap and ensure unprivileged user namespaces are permitted."}`}],details:{},isError:true};
        return{content:[{type:"text" as const,text:"Verifier sandbox ready: Linux Bubblewrap namespace started with the network isolated and only /tmp writable."}],details:{}};
      }catch(error){return{content:[{type:"text" as const,text:unavailable(error)}],details:{},isError:true};}
    }});
  pi.registerTool({name:"verify_command",label:"Read-only verification command",description:"Run argv without a shell in a Bubblewrap namespace where the host filesystem is read-only, only isolated /tmp is writable, and network access is disabled by default.",parameters:Params,
    execute:async(_id,params,signal,_onUpdate,ctx)=>{
      const [executable,...args]=params.argv;
      if(!executable||!ALLOWED.has(executable))return{content:[{type:"text" as const,text:`Denied executable: ${executable??""}`}],details:{},isError:true};
      const requested=params.cwd?new URL(params.cwd,`file://${ctx.cwd.replace(/\/$/,"")}/`).pathname:ctx.cwd;
      if(!(requested===ctx.cwd||requested.startsWith(`${ctx.cwd}/`)))return{content:[{type:"text" as const,text:"cwd must remain inside the verification workspace"}],details:{},isError:true};
      const platformError=sandboxPreflightError();
      if(platformError)return{content:[{type:"text" as const,text:platformError}],details:{},isError:true};
      try{
        const result=await pi.exec("bwrap",verifierBubblewrapArgs(requested,executable,args),{signal,timeout:300_000});
        return{content:[{type:"text" as const,text:`exit=${result.code}\n${`${result.stdout}${result.stderr}`.slice(0,64000)}`}],details:{},...(result.code===0?{}:{isError:true})};
      }catch(error){return{content:[{type:"text" as const,text:unavailable(error)}],details:{},isError:true};}
    }});
  pi.registerTool({name:"worker_command",label:"Workspace command",description:"Run argv in a sandbox where only the workspace and /tmp are writable; Git metadata is read-only.",parameters:Params,
    execute:async(_id,params,signal,_onUpdate,ctx)=>{
      const [executable,...args]=params.argv;
      if(!executable)return{content:[{type:"text" as const,text:"Missing executable"}],details:{},isError:true};
      const root=realpathSync(ctx.cwd);
      const requested=realpathSync(params.cwd?new URL(params.cwd,`file://${root.replace(/\/$/,"")}/`).pathname:root);
      if(!(requested===root||requested.startsWith(`${root}/`)))return{content:[{type:"text" as const,text:"cwd must remain inside the worker workspace"}],details:{},isError:true};
      const gitDir=`${root}/.git`;
      const mounts=["--die-with-parent","--unshare-all","--share-net","--ro-bind","/","/","--dev","/dev","--proc","/proc","--bind",root,root,"--tmpfs","/tmp"];
      try{realpathSync(gitDir);mounts.push("--ro-bind",gitDir,gitDir);}catch{/* Non-Git workspaces are valid. */}
      const platformError=sandboxPreflightError();
      if(platformError)return{content:[{type:"text" as const,text:platformError}],details:{},isError:true};
      try{
        const result=await pi.exec("bwrap",[...mounts,"--chdir",requested,"--",executable,...args],{signal,timeout:600_000});
        return{content:[{type:"text" as const,text:`exit=${result.code}\n${`${result.stdout}${result.stderr}`.slice(0,64000)}`}],details:{},...(result.code===0?{}:{isError:true})};
      }catch(error){return{content:[{type:"text" as const,text:unavailable(error)}],details:{},isError:true};}
    }});
}
