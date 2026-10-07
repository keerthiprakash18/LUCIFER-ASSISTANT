import { z } from 'zod';
export const taskStates = ['queued','running','awaiting_input','awaiting_authorization','completed','partially_completed','failed','cancelled'] as const;
export type TaskState = typeof taskStates[number];
export interface Task { id: string; title: string; state: TaskState; events: { at: string; text: string }[]; result?: unknown; error?: string; createdAt: string }
export interface Message { id: string; role: 'user'|'assistant'; text: string; createdAt: string; taskId?: string; fileIds?: string[] }
export interface Settings { language: 'auto'|'en-IN'|'ta-IN'; timezone: string; theme: 'light'|'dark'; accent: 'rose'|'violet'|'blue'|'emerald'|'gold'; spokenReplies: boolean; memoryEnabled: boolean; retentionDays: number; context: string; permissions: { model: boolean; files: boolean; reports: boolean; devices: boolean; telegram: boolean; reminders: boolean } }
export const defaultSettings: Settings = { language:'auto', timezone:'Asia/Kolkata', theme:'light', accent:'rose', spokenReplies:false, memoryEnabled:true, retentionDays:30, context:'personal', permissions:{model:true,files:true,reports:true,devices:true,telegram:true,reminders:true} };
export const settingsSchema = z.object({ language:z.enum(['auto','en-IN','ta-IN']), timezone:z.string().max(80).refine(v => { try { new Intl.DateTimeFormat('en',{timeZone:v}); return true; } catch { return false; } },'Invalid timezone'), theme:z.enum(['light','dark']), accent:z.enum(['rose','violet','blue','emerald','gold']).default('rose'), spokenReplies:z.boolean(), memoryEnabled:z.boolean(), retentionDays:z.number().int().min(1).max(365), context:z.string().min(1).max(80), permissions:z.object({model:z.boolean(),files:z.boolean(),reports:z.boolean(),devices:z.boolean(),telegram:z.boolean(),reminders:z.boolean()}) });
export interface Memory { id: string; context: string; key: string; value: string; provenance: string; updatedAt: string }
export interface StoredFile { id: string; name: string; type: string; bytes: number; text?: string; createdAt: string; expiresAt: string; generated: boolean; reportId?: string }
export const deviceActionSchema = z.discriminatedUnion('kind', [
  z.object({kind:z.literal('open_app'), app:z.string().min(1).max(60)}).strict(),
  z.object({kind:z.literal('open_website'), url:z.url().max(2048)}).strict(),
  z.object({kind:z.literal('open_project'), folder:z.string().min(1).max(60)}).strict(),
  z.object({kind:z.literal('read_file'), folder:z.string().min(1).max(60), path:z.string().min(1).max(300)}).strict(),
  z.object({kind:z.literal('find_files'), folder:z.string().min(1).max(60), query:z.string().min(1).max(100)}).strict(),
  z.object({kind:z.literal('write_document'), folder:z.string().min(1).max(60), path:z.string().min(1).max(300), text:z.string().max(100000)}).strict(),
  z.object({kind:z.literal('move_file'), folder:z.string().min(1).max(60), path:z.string().min(1).max(300), destination:z.string().min(1).max(300)}).strict(),
  z.object({kind:z.literal('run_command'), folder:z.string().min(1).max(60), command:z.string().min(1).max(60)}).strict(),
  z.object({kind:z.literal('edit_file'),folder:z.string().min(1).max(60),path:z.string().min(1).max(300),text:z.string().max(100000),expectedHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
  z.object({kind:z.literal('discover_apps')}).strict(),
  z.object({kind:z.literal('observe_app'),app:z.string().min(1).max(60)}).strict(),
  z.object({kind:z.literal('open_document'),app:z.enum(['notepad','vscode']),folder:z.string().min(1).max(60),path:z.string().min(1).max(300)}).strict(),
  z.object({kind:z.literal('browser_action'),operation:z.enum(['open','observe','search','click','fill']),url:z.string().max(2048).optional(),query:z.string().max(300).optional(),reference:z.string().max(100).optional(),text:z.string().max(2000).optional()}).strict(),
  z.object({kind:z.literal('system_control'),operation:z.enum(['volume_up','volume_down','volume_mute'])}).strict(),
  z.object({kind:z.literal('system_info')}).strict(),
]);
export type DeviceAction = z.infer<typeof deviceActionSchema>;
export interface Capabilities { apps:string[]; folders:string[]; commands:string[]; actions:string[] }
export interface Device { id:string; name:string; platform:string; capabilities:Capabilities; lastSeen:string; revoked:boolean }
export interface DeviceCommand { id:string; taskId:string; deviceId:string; action:DeviceAction; status:'pending'|'claimed'|'completed'|'failed'|'cancelled'; expiresAt:string; result?:unknown;ownerApproved?:boolean;parentTaskId?:string }
export const reminderSchema = z.object({ title:z.string().min(1).max(300), at:z.iso.datetime({offset:true}), timezone:z.string().max(80).refine(v=>{try{new Intl.DateTimeFormat('en',{timeZone:v});return true;}catch{return false;}}), recurrence:z.enum(['none','daily','weekly']), channel:z.enum(['in_app','telegram']) });
export interface Reminder extends z.infer<typeof reminderSchema> { id:string; status:'scheduled'|'delivered'|'failed'|'cancelled'|'uncertain'; lastError?:string }
export interface Skill { id:string; purpose:string; inputs:string[]; integrations:string[]; permissions:string[]; tools:string[]; output:string; checks:string[]; recovery:string; status:string }
export interface ToolContext { signal:AbortSignal; taskId:string; userText:string; fileIds:string[]; settings:Settings; nativeDeviceId?:string }
export interface ProviderToolCall { id:string; name:string; arguments:string; geminiThoughtSignature?:string }
export interface ProviderToolResult { callId:string; name:string; output:unknown }
export interface ProviderTurn { calls:ProviderToolCall[]; results:ProviderToolResult[] }
export interface ModelProvider { respond(input: { history:Message[]; context:Memory[]; tools:unknown[]; signal:AbortSignal; turns?:ProviderTurn[] }):Promise<{text:string; calls:ProviderToolCall[]; raw:unknown[]; sources?:unknown[];served?:{provider:string;model:string};diagnostics?:unknown}> }
