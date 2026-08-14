import { afterEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  clampScale,
  DiagramViewer,
  MAX_SCALE,
  MIN_SCALE,
  scaleToFit,
} from '@/features/docs/diagram-viewer.tsx';

afterEach(cleanup);

const SVG = '<svg role="graphics-document" viewBox="0 0 2000 400"><g></g></svg>';

describe('the scale a diagram opens at', () => {
  it('shrinks a wide diagram to the viewport and never enlarges a small one', () => {
    expect(scaleToFit(2000, 1000)).toBe(0.5);
    expect(scaleToFit(400, 1000)).toBe(1);
  });

  it('stays inside the range the controls can reach', () => {
    expect(scaleToFit(100_000, 100)).toBe(MIN_SCALE);
    expect(clampScale(99)).toBe(MAX_SCALE);
    expect(clampScale(0)).toBe(MIN_SCALE);
  });

  it('answers 1 before the viewport has been measured', () => {
    expect(scaleToFit(0, 1000)).toBe(1);
    expect(scaleToFit(2000, 0)).toBe(1);
  });
});

describe('the diagram viewer', () => {
  it('stays shut until a diagram is handed to it', () => {
    render(<DiagramViewer svg={null} label="Diagram" onClose={mock()} />);

    expect(screen.queryByTestId('diagram-viewer')).toBeNull();
  });

  it('shows the diagram with controls for zoom, pan and fit', () => {
    render(<DiagramViewer svg={SVG} label="Edge and traffic path" onClose={mock()} />);

    expect(screen.getByTestId('diagram-viewer')).toBeInTheDocument();
    expect(screen.getByText('Edge and traffic path')).toBeInTheDocument();
    for (const label of [
      'Zoom in',
      'Zoom out',
      'Pan up',
      'Pan down',
      'Pan left',
      'Pan right',
      'Fit the diagram to the viewer',
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });

  it('reports the zoom it is at, and moves it a step at a time', async () => {
    const user = userEvent.setup();
    render(<DiagramViewer svg={SVG} label="Diagram" onClose={mock()} />);

    expect(screen.getByTestId('diagram-zoom').textContent).toBe('100%');

    await user.click(screen.getByLabelText('Zoom in'));
    expect(screen.getByTestId('diagram-zoom').textContent).toBe('125%');

    await user.click(screen.getByLabelText('Zoom out'));
    expect(screen.getByTestId('diagram-zoom').textContent).toBe('100%');
  });

  it('pans with the arrow keys and returns home on 0', async () => {
    const user = userEvent.setup();
    render(<DiagramViewer svg={SVG} label="Diagram" onClose={mock()} />);

    const viewport = screen.getByTestId('diagram-viewport');
    screen.getByTestId('diagram-viewer').focus();
    await user.keyboard('{ArrowRight}');

    const moved = viewport.firstElementChild as HTMLElement;
    expect(moved.style.transform).toContain('translate(-80px, 0px)');

    await user.keyboard('0');
    expect(moved.style.transform).toContain('translate(0px, 0px)');
  });

  it('pans while a pointer drags across it', () => {
    render(<DiagramViewer svg={SVG} label="Diagram" onClose={mock()} />);
    const viewport = screen.getByTestId('diagram-viewport');
    const moved = viewport.firstElementChild as HTMLElement;

    fireEvent.pointerDown(viewport, { pointerId: 1, clientX: 200, clientY: 120 });
    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 260, clientY: 150 });

    expect(moved.style.transform).toContain('translate(60px, 30px)');

    fireEvent.pointerUp(viewport, { pointerId: 1 });
    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 400, clientY: 400 });

    expect(moved.style.transform).toContain('translate(60px, 30px)');
  });

  it('zooms with the wheel, in the direction the wheel turned', () => {
    render(<DiagramViewer svg={SVG} label="Diagram" onClose={mock()} />);
    const viewport = screen.getByTestId('diagram-viewport');

    fireEvent.wheel(viewport, { deltaY: -120 });
    expect(screen.getByTestId('diagram-zoom').textContent).toBe('125%');

    fireEvent.wheel(viewport, { deltaY: 120 });
    expect(screen.getByTestId('diagram-zoom').textContent).toBe('100%');
  });

  it('closes when the reader asks it to', async () => {
    const user = userEvent.setup();
    const onClose = mock();
    render(<DiagramViewer svg={SVG} label="Diagram" onClose={onClose} />);

    await user.click(screen.getByLabelText('Close'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
