import {
  KeyboardCode,
  type KeyboardCodes,
  KeyboardSensor,
  type KeyboardSensorOptions,
  type KeyboardSensorProps,
  PointerSensor,
  type PointerSensorOptions,
  type PointerSensorProps,
  type Sensor,
  type SensorInstance,
  type SensorProps,
} from '@dnd-kit/core';

const defaultKeyboardCodes: KeyboardCodes = {
  start: [KeyboardCode.Space, KeyboardCode.Enter],
  cancel: [KeyboardCode.Esc],
  end: [KeyboardCode.Space, KeyboardCode.Enter, KeyboardCode.Tab],
};

let cancellationSequence = 0;

type CancellationMode = 'context' | 'teardown';

interface SensorRegistration {
  active: boolean;
  requested: boolean;
  mode: CancellationMode | null;
  cancel: (mode: CancellationMode) => void;
}

export interface BoardSensorController {
  readonly Keyboard: Sensor<KeyboardSensorOptions>;
  readonly Pointer: Sensor<PointerSensorOptions>;
  readonly mount: () => void;
  readonly unmount: () => void;
  readonly cancel: () => void;
}

export function createBoardSensorController(): BoardSensorController {
  let current: SensorRegistration | null = null;
  let mounted = false;

  const release = (registration: SensorRegistration) => {
    registration.active = false;
    if (current === registration) current = null;
  };

  const requestCancellation = (
    registration: SensorRegistration,
    mode: CancellationMode,
  ): boolean => {
    if (!registration.active) return false;
    if (mode === 'teardown' || registration.mode === null) registration.mode = mode;
    if (registration.requested) return false;
    registration.requested = true;
    return true;
  };

  const lifecycleProps = <Options extends object>(
    props: SensorProps<Options>,
    registration: SensorRegistration,
  ): SensorProps<Options> => ({
    ...props,
    onAbort(id) {
      if (!registration.active || registration.mode === 'teardown') return;
      props.onAbort(id);
    },
    onCancel() {
      if (!registration.active) return;
      const notify = registration.mode !== 'teardown';
      release(registration);
      if (notify) props.onCancel();
    },
    onEnd() {
      if (!registration.active) return;
      const notify = registration.mode !== 'teardown';
      release(registration);
      if (notify) props.onEnd();
    },
  });

  const register = (registration: SensorRegistration) => {
    if (current !== null && current !== registration) current.cancel('teardown');
    if (!mounted) {
      registration.cancel('teardown');
      return;
    }
    current = registration;
  };

  class ControlledPointerSensor implements SensorInstance {
    static readonly activators = PointerSensor.activators;
    readonly autoScrollEnabled: boolean;

    constructor(props: PointerSensorProps) {
      const ownerDocument = props.activeNode.node.current?.ownerDocument ?? document;
      const ownerWindow = ownerDocument.defaultView ?? window;
      const registration: SensorRegistration = {
        active: true,
        requested: false,
        mode: null,
        cancel(mode) {
          if (!requestCancellation(registration, mode)) return;
          ownerDocument.dispatchEvent(
            new ownerWindow.Event('pointercancel', { bubbles: false, cancelable: true }),
          );
        },
      };
      const delegate = new PointerSensor(lifecycleProps(props, registration));
      this.autoScrollEnabled = delegate.autoScrollEnabled;
      register(registration);
    }
  }

  class ControlledKeyboardSensor implements SensorInstance {
    static readonly activators = KeyboardSensor.activators;
    readonly autoScrollEnabled: boolean;

    constructor(props: KeyboardSensorProps) {
      cancellationSequence += 1;
      const cancellationCode = `OrbitBoardCancel${cancellationSequence}`;
      const ownerDocument = props.activeNode.node.current?.ownerDocument ?? document;
      const ownerWindow = ownerDocument.defaultView ?? window;
      const configuredCodes = props.options.keyboardCodes ?? defaultKeyboardCodes;
      const registration: SensorRegistration = {
        active: true,
        requested: false,
        mode: null,
        cancel(mode) {
          if (!requestCancellation(registration, mode)) return;
          ownerWindow.setTimeout(() => {
            if (!registration.active) return;
            ownerDocument.dispatchEvent(
              new ownerWindow.KeyboardEvent('keydown', {
                key: 'Unidentified',
                code: cancellationCode,
                bubbles: false,
                cancelable: true,
              }),
            );
          }, 0);
        },
      };
      const wrapped = lifecycleProps(props, registration);
      const delegate = new KeyboardSensor({
        ...wrapped,
        options: {
          ...wrapped.options,
          keyboardCodes: {
            start: [...configuredCodes.start],
            cancel: [...configuredCodes.cancel, cancellationCode],
            end: [...configuredCodes.end],
          },
        },
      });
      this.autoScrollEnabled = delegate.autoScrollEnabled;
      register(registration);
    }
  }

  return {
    Keyboard: ControlledKeyboardSensor,
    Pointer: ControlledPointerSensor,
    mount() {
      mounted = true;
    },
    unmount() {
      mounted = false;
      current?.cancel('teardown');
    },
    cancel() {
      current?.cancel('context');
    },
  };
}
