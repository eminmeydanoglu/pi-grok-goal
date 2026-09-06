import { Type } from "@sinclair/typebox";
import { realpathSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const Params = Type.Object({argv:Type.Array(Type.String({minLength:1,maxLength:512}),{minItems:1,maxItems:32}),cwd:Type.Optional(Type.String({maxLength:1024}))},{additionalProperties:false});
const ALLOWED = new Set(["node","npm","npx","git","python","python3","pytest","cargo"]);

export default function verifierTools(pi: ExtensionAPI) {
  pi.registerTool({name:"verify_command",label:"Read-only verification command",description:"Run argv without a shell in a Bubblewrap namespace where the host filesystem is read-only and only isolated /tmp is writable.",parameters:Params,
    execute:async(_id,params,signal,_onUpdate,ctx)=>{
      const [executable,...args]=params.argv;
      if(!executable||!ALLOWED.has(executable))return{content:[{type:"text" as const,text:`Denied executable: ${executable??""}`}],details:{},isError:true};
      const requested=params.cwd?new URL(params.cwd,`file://${ctx.cwd.replace(/\/$/,"")}/`).pathname:ctx.cwd;
      if(!(requested===ctx.cwd||requested.startsWith(`${ctx.cwd}/`)))return{content:[{type:"text" as const,text:"cwd must remain inside the verification workspace"}],details:{},isError:true};
      const result=await pi.exec("bwrap",["--die-with-parent","--unshare-all","--share-net","--ro-bind","/","/","--dev","/dev","--proc","/proc","--tmpfs","/tmp","--chdir",requested,"--",executable,...args],{signal,timeout:300_000});
      return{content:[{type:"text" as const,text:`exit=${result.code}\n${`${result.stdout}${result.stderr}`.slice(0,64000)}`}],details:{},...(result.code===0?{}:{isError:true})};
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
      const result=await pi.exec("bwrap",[...mounts,"--chdir",requested,"--",executable,...args],{signal,timeout:600_000});
      return{content:[{type:"text" as const,text:`exit=${result.code}\n${`${result.stdout}${result.stderr}`.slice(0,64000)}`}],details:{},...(result.code===0?{}:{isError:true})};
    }});
}
