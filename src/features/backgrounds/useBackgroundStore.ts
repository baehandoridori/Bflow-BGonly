import { create } from 'zustand';
import { applyBackgroundCommand, BackgroundUnsupportedError, emptyBackgroundSnapshot, validateBackgroundSnapshot } from './domain.ts';
import type { BackgroundCommand, BackgroundGateway, BackgroundSnapshot } from './types.ts';
import { mapSaveWasApplied } from './mapWorkflow.ts';

export interface BackgroundState {
  snapshot:BackgroundSnapshot;actorId:string|null;loading:boolean;pending:boolean;error:string|null;
  /** The stored library holds a kind, key or value this version does not know: nothing is shown and nothing is saved until the app is updated. */
  updateRequired: boolean;
  initialize(actorId:string|null,gateway?:BackgroundGateway):Promise<void>;
  refresh(preserveError?:boolean):Promise<boolean>;execute(command:BackgroundCommand):Promise<void>;
}
function defaultGateway():BackgroundGateway {
  const api=typeof window==='undefined'?undefined:window.electronAPI;
  if(!api?.backgroundRead||!api?.backgroundExecute)throw new Error('배경 저장 기능이 준비되지 않았습니다. 앱을 다시 실행해 주세요.');
  return {read:()=>api.backgroundRead(),execute:request=>api.backgroundExecute(request),subscribe:listener=>api.onBackgroundChanged?.(listener)??(()=>{})};
}
const message=(error:unknown)=>error instanceof Error?error.message:String(error);
export function createBackgroundStore(){
  let gateway:BackgroundGateway|null=null,generation=0,readTicket=0,unsubscribe:(()=>void)|null=null,refreshQueued=false;
  return create<BackgroundState>((set,get)=>({
    snapshot:emptyBackgroundSnapshot(),actorId:null,loading:false,pending:false,error:null,updateRequired:false,
    initialize:async(actorId,supplied)=>{
      const version=++generation;++readTicket;unsubscribe?.();unsubscribe=null;gateway=null;refreshQueued=false;
      set({snapshot:emptyBackgroundSnapshot(),actorId,loading:!!actorId,pending:false,error:null,updateRequired:false});if(!actorId)return;
      try{const active=supplied??defaultGateway();gateway=active;unsubscribe=active.subscribe?.(()=>{if(version!==generation)return;if(get().pending){refreshQueued=true;return;}void get().refresh();})??null;await get().refresh();}
      catch(error){if(version===generation)set({loading:false,error:message(error)});}
    },
    refresh:async(preserveError=false)=>{
      if(!gateway||!get().actorId)return false;if(get().pending){refreshQueued=true;return false;}
      const active=gateway,version=generation,ticket=++readTicket;
      try{const snapshot=await active.read();validateBackgroundSnapshot(snapshot);if(version!==generation||ticket!==readTicket||get().pending)return false;set({snapshot,loading:false,updateRequired:false,...(!preserveError?{error:null}:{})});return true;}
      catch(error){
        if(version===generation&&ticket===readTicket){
          if(error instanceof BackgroundUnsupportedError){
            // Logged only as the notice turns on: the screen reads again every 15 seconds and would repeat the line.
            if (!get().updateRequired) console.warn('[background] update required:', error.message, error.detail);
            set({ loading: false, updateRequired: true, error: null });
          }else set({loading:false,error:message(error)});
        }
        return false;
      }
    },
    execute:async(command)=>{
      if(!gateway||!get().actorId)throw new Error('로그인이 필요합니다.');if(get().loading||get().pending)throw new Error('진행 중인 저장이 끝난 뒤 다시 시도해 주세요.');
      if (get().updateRequired) throw new Error('앱을 업데이트한 뒤 다시 저장해 주세요.');
      const active=gateway,version=generation,before=get().snapshot;
      const optimistic=applyBackgroundCommand(before,command,{canManage:before.canManage});++readTicket;refreshQueued=false;
      set({snapshot:optimistic,pending:true,error:null});let failed=false;
      try{
        const snapshot=await active.execute({requestId:crypto.randomUUID(),command});validateBackgroundSnapshot(snapshot);
        if(version!==generation)throw new Error('로그인 세션이 변경되어 저장 응답을 폐기했습니다.');
        set({snapshot,pending:false});
      }catch(error){
        if(version!==generation)throw error;
        // Keep the mutation lock while recovering so recovery cannot overwrite a newer edit.
        failed=true;
        // What the reply held that this version does not know, or failing that what the recovery read held.
        let restored=before,unsupported=error instanceof BackgroundUnsupportedError?error:null;
        try{const canonical=await active.read();validateBackgroundSnapshot(canonical);restored=canonical;}
        catch(recovery){/* retain last confirmed state */if(!unsupported&&recovery instanceof BackgroundUnsupportedError)unsupported=recovery;}
        if(version===generation&&command.type==='save-maps'&&mapSaveWasApplied(restored,command)){
          failed=false;set({snapshot:restored,pending:false,error:null});return;
        }
        if(version===generation){
          if(unsupported){
            if (!get().updateRequired) console.warn('[background] update required:', unsupported.message, unsupported.detail);
            set({ snapshot: restored, pending: false, updateRequired: true, error: null });
          }else set({snapshot:restored,pending:false,error:message(error)});
        }
        throw error;
      }finally{
        if(version===generation&&refreshQueued){refreshQueued=false;void get().refresh(failed);}
      }
    },
  }));
}
export const useBackgroundStore=createBackgroundStore();
