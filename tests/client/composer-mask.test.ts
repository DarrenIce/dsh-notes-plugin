import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { ComponentType } from 'react';
import { registerComposerMask, type ComposerMaskHost, type ComposerMaskOptions } from '../../src/client/composer-mask';

function capture() {
  const registrations: { options: ComposerMaskOptions; component: ComponentType }[] = [];
  let disposed = 0;
  const host = {
    slots: {
      register(options: ComposerMaskOptions, component: ComponentType) {
        registrations.push({ options, component });
        return () => { disposed += 1; };
      },
    },
  };
  return { host, registrations, disposed: () => disposed };
}

test('composer mask elects its session only while no interaction is pending', () => {
  const captured = capture();
  const dispose = registerComposerMask(captured.host, 'session-a');
  assert.equal(captured.registrations.length, 1);
  const { options, component } = captured.registrations[0];
  assert.equal(options.name, 'conversation.composer');
  assert.equal(options.priority, 1000);
  assert.deepEqual(options.select({ sessionId: 'session-a' }), { sessionId: 'session-a' });
  assert.equal(options.select({ sessionId: 'session-b' }), null);
  assert.equal(options.select({ sessionId: 'session-a', pendingInteraction: { kind: 'approval' } }), null);
  assert.deepEqual(options.select({ sessionId: 'session-a', pendingInteraction: null }), { sessionId: 'session-a' });
  assert.equal(component(), null);
  dispose();
  assert.equal(captured.disposed(), 1);
});

test('composer mask degrades to a no-op when the host slot is unavailable', () => {
  const original = console.warn;
  console.warn = () => {};
  try {
    const host = { slots: { register() { throw new Error('missing slot'); } } } as unknown as ComposerMaskHost;
    const dispose = registerComposerMask(host, 'session-a');
    assert.equal(typeof dispose, 'function');
    dispose();
  } finally {
    console.warn = original;
  }
});
