import { afterEach, describe, expect, it, mock } from 'bun:test';
import type { KeyboardSensorProps, PointerSensorProps, SensorProps } from '@dnd-kit/core';
import { createBoardSensorController } from '@/features/issues/board-sensors.ts';

function activationEvent(type: 'keyboard' | 'pointer', node: HTMLElement): Event {
  const event =
    type === 'keyboard'
      ? new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
      : new PointerEvent('pointerdown', { button: 0, isPrimary: true, bubbles: true });
  node.dispatchEvent(event);
  return event;
}

function sensorProps<Options extends object>(
  event: Event,
  node: HTMLElement,
  options: Options,
  onCancel: () => void,
): SensorProps<Options> {
  return {
    active: 'issue_1',
    activeNode: {
      id: 'issue_1',
      key: 'issue_1',
      node: { current: node },
      data: { current: {} },
    },
    event,
    context: { current: {} },
    options,
    onAbort: mock(),
    onPending: mock(),
    onStart: mock(),
    onCancel,
    onMove: mock(),
    onEnd: mock(),
  } as unknown as SensorProps<Options>;
}

function card(): HTMLElement {
  const node = document.createElement('div');
  node.tabIndex = 0;
  document.body.append(node);
  return node;
}

async function settleTimers(): Promise<void> {
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('board sensor cancellation', () => {
  it('cancels a keyboard sensor once after its deferred listener attaches', async () => {
    const controller = createBoardSensorController();
    const node = card();
    const onCancel = mock();
    controller.mount();
    new controller.Keyboard(
      sensorProps(activationEvent('keyboard', node), node, {}, onCancel) as KeyboardSensorProps,
    );

    controller.cancel();
    await settleTimers();
    expect(onCancel).toHaveBeenCalledTimes(1);

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', cancelable: true }),
    );
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('does not let an old keyboard cancellation reach a replacement controller', async () => {
    const first = createBoardSensorController();
    const second = createBoardSensorController();
    const firstCancel = mock();
    const secondCancel = mock();
    const firstNode = card();
    const secondNode = card();
    first.mount();
    new first.Keyboard(
      sensorProps(
        activationEvent('keyboard', firstNode),
        firstNode,
        {},
        firstCancel,
      ) as KeyboardSensorProps,
    );

    first.cancel();
    first.unmount();
    second.mount();
    new second.Keyboard(
      sensorProps(
        activationEvent('keyboard', secondNode),
        secondNode,
        {},
        secondCancel,
      ) as KeyboardSensorProps,
    );
    await settleTimers();

    expect(firstCancel).not.toHaveBeenCalled();
    expect(secondCancel).not.toHaveBeenCalled();
    second.cancel();
    await settleTimers();
    expect(secondCancel).toHaveBeenCalledTimes(1);
  });

  it('does not emit Escape while cancelling a keyboard sensor', async () => {
    const controller = createBoardSensorController();
    const node = card();
    const onCancel = mock();
    const onEscape = mock();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.code === 'Escape') onEscape();
    };
    document.addEventListener('keydown', onKeyDown);
    controller.mount();
    new controller.Keyboard(
      sensorProps(activationEvent('keyboard', node), node, {}, onCancel) as KeyboardSensorProps,
    );

    controller.cancel();
    await settleTimers();

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onEscape).not.toHaveBeenCalled();
    document.removeEventListener('keydown', onKeyDown);
  });

  it('cancels a pointer sensor synchronously without resizing the window', () => {
    const controller = createBoardSensorController();
    const node = card();
    const onCancel = mock();
    const onResize = mock();
    window.addEventListener('resize', onResize, { once: true });
    controller.mount();
    new controller.Pointer(
      sensorProps(activationEvent('pointer', node), node, {}, onCancel) as PointerSensorProps,
    );

    controller.cancel();

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onResize).not.toHaveBeenCalled();
    window.removeEventListener('resize', onResize);
  });
});
