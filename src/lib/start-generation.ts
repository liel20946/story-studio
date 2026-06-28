import { generateCreate } from "./ipc";

/** Create a generate conversation and return its id. */
export async function startNewGeneration(): Promise<string> {
  const conversation = await generateCreate();
  return conversation.id;
}
