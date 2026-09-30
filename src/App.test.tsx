// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import fixture from '../data/gradebook.fixture.json';
import { App } from './App';

const okResponse = () =>
  new Response(JSON.stringify({ source: 'fixture', data: fixture }), { status: 200 });

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(() => Promise.resolve(okResponse())),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const bodyRows = () =>
  within(screen.getByRole('table').querySelector('tbody')!).getAllByRole('row');
const row = (name: string) => bodyRows().find((r) => r.textContent?.includes(name))!;

describe('App', () => {
  it('renders the report: students, task/exam columns, single participation block', async () => {
    render(<App />);
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.getByText('Students: 7')).toBeInTheDocument();
    expect(screen.getByText('Tasks: 3')).toBeInTheDocument();
    expect(screen.getByText('Exams: 2')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Task 03' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Exam 02' })).toBeInTheDocument();
    expect(
      screen.getAllByRole('columnheader', { name: /Participación \/ asistencia/ }),
    ).toHaveLength(1);
    expect(screen.queryByText(/^Asistencia$|^Participación$/)).not.toBeInTheDocument();
    expect(bodyRows()).toHaveLength(7);
    expect(screen.getByRole('note')).toHaveTextContent(/synthetic/i);
  });

  it('shows contribution / maximum and the final grade', async () => {
    render(<App />);
    await screen.findByRole('table');
    const alpha = within(row('Alpha'));
    expect(alpha.getByText('40.00 / 40')).toBeInTheDocument();
    expect(alpha.getByText('34.00 / 40')).toBeInTheDocument();
    expect(alpha.getByText('18.00 / 20')).toBeInTheDocument();
    expect(alpha.getByText('92.00')).toBeInTheDocument();
  });

  it('distinguishes null ("—") from zero ("0")', async () => {
    render(<App />);
    await screen.findByRole('table');
    const cells = (name: string) =>
      within(row(name))
        .getAllByRole('cell')
        .map((c) => c.textContent);
    expect(cells('Bravo')[1]).toBe('0');
    expect(cells('Charlie')[3]).toBe('—');
  });

  it('marks an incomplete final and names the missing block', async () => {
    render(<App />);
    await screen.findByRole('table');
    expect(within(row('Echo')).getByText(/Incomplete/)).toBeInTheDocument();
    expect(within(row('Echo')).getByText(/falta: Participación \/ asistencia/)).toBeInTheDocument();
  });

  it('filters by name and by account', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('table');
    const search = screen.getByLabelText(/Search student/);
    await user.type(search, 'delta');
    expect(bodyRows()).toHaveLength(1);
    await user.clear(search);
    await user.type(search, 'FX0002');
    expect(bodyRows()).toHaveLength(1);
    expect(bodyRows()[0]).toHaveTextContent('Bravo');
    await user.clear(search);
    await user.type(search, 'zzz');
    expect(screen.getByText(/No students match/)).toBeInTheDocument();
  });

  it('sorts by final grade, incomplete last', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('table');
    expect(bodyRows()[0]).toHaveTextContent('Alpha');
    await user.click(screen.getByRole('button', { name: /CALIFICACIÓN FINAL/ }));
    expect(bodyRows()[0]).toHaveTextContent('Charlie');
    expect(bodyRows()[6]).toHaveTextContent('Golf');
  });

  it('opens and closes the student detail', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: /Fixture Student Charlie/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Account: FX0003')).toBeInTheDocument();
    expect(within(dialog).getByText('36.00 / 40')).toBeInTheDocument();
    expect(within(dialog).getByText(/calculated by Gradebook/)).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it.each([
    ['unauthorized', 'not authorized'],
    ['forbidden', 'permission'],
    ['course_not_found', 'not found'],
    ['malformed_response', 'unexpected format'],
    ['api_unavailable', 'did not respond'],
  ])('shows a clear message for %s', async (code, text) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: code }), { status: 502 })),
    );
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
  });

  it('rejects a 200 response that fails the contract', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ source: 'api', data: {} }))),
    );
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('unexpected format');
  });
});
