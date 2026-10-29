import type { ComponentType } from 'react';

/** Owner values the host hands to a `conversation.composer` chain selector. */
export interface ComposerMaskOwner {
  sessionId?: string;
  pendingInteraction?: unknown;
}
export interface ComposerMaskOptions {
  name: 'conversation.composer';
  id: string;
  /** Run after ordinary (0) takeovers so request UIs keep their composer. */
  priority: number;
  select: (owner: ComposerMaskOwner) => { sessionId: string } | null;
}
export interface ComposerMaskHost {
  slots: {
    register: (options: ComposerMaskOptions, component: ComponentType) => () => void;
  };
}

const ComposerMask: ComponentType = () => null;
let sequence = 0;

/**
 * Hide the resident composer while the decision board owns the active view.
 * The host chain renderer keeps the default composer mounted but hides its
 * fallback (`display:none`) during a takeover and restores it on dispose.
 * A pending interaction declines the takeover so the user can answer it.
 */
export function registerComposerMask(host: ComposerMaskHost, sessionId: string): () => void {
  try {
    return host.slots.register({
      name: 'conversation.composer',
      id: `decision-notes-composer-mask:${++sequence}`,
      priority: 1000,
      select: owner => owner.sessionId === sessionId
        && (owner.pendingInteraction === undefined || owner.pendingInteraction === null)
        ? { sessionId } : null,
    }, ComposerMask);
  } catch (error) {
    console.warn('[write-notes-like-deepseek] composer mask unavailable', error);
    return () => {};
  }
}
