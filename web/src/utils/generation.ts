import { Channel, invoke } from '@tauri-apps/api/core';
import type { PromptMessage } from './promptCompiler';
export interface GenerationRequest {
  providerId: string;
  requestId: string;
  messages: PromptMessage[];
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  purpose?: 'memory';
}
export interface Completion {
  text: string;
  usage: unknown;
}
export async function generateChat(
  request: GenerationRequest,
  onDelta: (delta: string) => void,
): Promise<Completion> {
  const onEvent = new Channel<{ requestId: string; delta: string }>();
  onEvent.onmessage = (event) => {
    if (event.requestId === request.requestId) onDelta(event.delta);
  };
  return invoke<Completion>('generate_chat', { request, onEvent });
}
export const cancelGeneration = (requestId: string) =>
  invoke<boolean>('cancel_generation', { requestId });
