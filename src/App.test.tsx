// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import real from '../data/gradebook.fixture.json';
import complete from './test/gradebookComplete.json';
import { App } from './App';
import { compactActivityLabel } from './domain/format';

const stubGradebook = (data: unknown) =>
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ source: 'fixture', data }), { status: 200 })),
      ),
  );

beforeEach(() => stubGradebook(complete));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const bodyRows = () =>
  within(screen.getByRole('table').querySelector('tbody')!).getAllByRole('row');
const row = (name: string) => bodyRows().find((r) => r.textContent?.includes(name))!;

const cells = (name: string) =>
  within(row(name))
    .getAllByRole('cell')
    .map((c) => c.textContent);

describe('App', () => {
  it('renders the report: students, task/exam columns, single participation block', async () => {
    render(<App />);
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.getByText('Students: 6')).toBeInTheDocument();
    expect(screen.getByText('Tasks: 4')).toBeInTheDocument();
    expect(screen.getByText('Exams: 2')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Tarea 03' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Examen 2' })).toBeInTheDocument();
    // compact label; the original activity name stays in the tooltip
    const excluded = screen.getByRole('columnheader', { name: 'Tarea 04 *' });
    expect(excluded).toHaveAttribute('title', expect.stringContaining('Tarea 04 (not counted)'));
    expect(
      screen.getAllByRole('columnheader', { name: /Participación \/ asistencia/ }),
    ).toHaveLength(1);
    expect(screen.queryByRole('columnheader', { name: /^Asistencia|^Participación$/ })).toBeNull();
    expect(bodyRows()).toHaveLength(6);
    expect(screen.getByRole('note')).toHaveTextContent(/synthetic/i);
    expect(
      screen.getByText(/Tasks 40% · Exams 40% · Participation \/ attendance 20%/),
    ).toBeInTheDocument();
  });

  it('shows average and contribution / maximum per block, and the final', async () => {
    render(<App />);
    await screen.findByRole('table');
    expect(cells('Alpha')).toEqual([
      'FX0001',
      '100',
      '100',
      '90',
      '50',
      '96.67',
      '38.67 / 40',
      '90',
      '80',
      '85.00',
      '34.00 / 40',
      '90',
      '90.00',
      '18.00 / 20',
      '70',
      '90.67',
    ]);
  });

  it('shows the normalised score_100, not the raw grade (Task 02 is 10/10)', async () => {
    render(<App />);
    await screen.findByRole('table');
    expect(cells('Alpha')[2]).toBe('100');
    expect(within(row('Alpha')).getAllByRole('cell')[2]).toHaveAttribute(
      'title',
      expect.stringContaining('10 / 10'),
    );
  });

  it('distinguishes null ("—") from zero ("0")', async () => {
    render(<App />);
    await screen.findByRole('table');
    expect(cells('Bravo')[1]).toBe('0');
    expect(cells('Bravo')[11]).toBe('0'); // a real zero in participation
    expect(cells('Bravo')[13]).toBe('0.00 / 20');
    expect(cells('Delta')[3]).toBe('—');
  });

  it('null participation stays "—" and the final is INCOMPLETA (not the API current grade)', async () => {
    render(<App />);
    await screen.findByRole('table');
    const charlie = cells('Charlie');
    expect(charlie[11]).toBe('—');
    expect(charlie[12]).toBe('—');
    expect(charlie[13]).toBe('— / 20');
    expect(within(row('Charlie')).getByText(/INCOMPLETA/)).toBeInTheDocument();
    expect(
      within(row('Charlie')).getByText(/falta: Participación \/ asistencia/),
    ).toBeInTheDocument();
    expect(charlie[15]).not.toMatch(/\d/); // no number: API current grade (100) not used
    expect(within(row('Echo')).getByText(/falta: Exámenes/)).toBeInTheDocument();
  });

  it('keeps the unassigned activity visible but out of the weighted blocks', async () => {
    render(<App />);
    await screen.findByRole('table');
    expect(
      screen.getByRole('columnheader', { name: /Extra 01 \(unassigned\)/ }),
    ).toBeInTheDocument();
    expect(cells('Foxtrot')[14]).toBe('100');
    expect(cells('Foxtrot')[15]).toBe('90.00');
  });

  it('real course state: unassigned activities are visible but INCOMPLETA names both missing blocks', async () => {
    stubGradebook(real);
    render(<App />);
    await screen.findByRole('table');
    expect(bodyRows()).toHaveLength(3);
    expect(cells('Alpha')).toEqual([
      'FX0001',
      '80',
      '80.00',
      '32.00 / 40',
      '—',
      '— / 40',
      '—',
      '— / 20',
      '90',
      '70',
      '85',
      expect.stringContaining('INCOMPLETA'),
    ]);
    expect(
      within(row('Alpha')).getByText(/falta: Exámenes, Participación \/ asistencia/),
    ).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Tarea 02' })).toBeInTheDocument();
    expect(
      screen.getAllByRole('columnheader', { name: /Participación \/ asistencia/ }),
    ).toHaveLength(1);
    expect(screen.getByRole('region', { name: 'Diagnostics' })).toHaveTextContent(/unassigned/);
  });

  it('detail shows unassigned grades with max grade and the simplified API current-grade note', async () => {
    stubGradebook(real);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: /^Alpha Fixture$/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Examen 1:\s*85 \/ 100/)).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'Academic API current grade: 80.00 / 100 (calculated only from currently evaluated categories; not used as the final grade).',
      ),
    ).toBeInTheDocument();
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

  it('sorts by final grade, INCOMPLETA last', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('table');
    expect(bodyRows()[0]).toHaveTextContent('Alpha');
    await user.click(screen.getByRole('button', { name: /CALIFICACIÓN FINAL/ }));
    expect(bodyRows()[1]).toHaveTextContent('Foxtrot');
    expect(bodyRows()[5]).toHaveTextContent('Echo');
    await user.click(screen.getByRole('button', { name: /CALIFICACIÓN FINAL/ }));
    expect(bodyRows()[0]).toHaveTextContent('Bravo');
    expect(bodyRows()[5]).toHaveTextContent('Echo');
  });

  it('opens and closes the student detail', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: /^Charlie Fixture$/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Account: FX0003')).toBeInTheDocument();
    expect(within(dialog).getAllByText('40.00 / 40')).toHaveLength(2);
    expect(within(dialog).getByText('No participation data has been entered.')).toBeInTheDocument();
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

  describe('student focus', () => {
    const focusButton = (name: string) =>
      screen.getByRole('button', { name: `Focus on ${name} Fixture` });
    const blurredNames = () =>
      bodyRows()
        .filter((r) => r.classList.contains('blurred'))
        .map((r) => within(r).getAllByRole('button')[0]!.textContent);

    it('starts with nobody focused and does not blur column headers', async () => {
      render(<App />);
      await screen.findByRole('table');
      expect(blurredNames()).toEqual([]);
      const user = userEvent.setup();
      await user.click(focusButton('Bravo'));
      const thead = screen.getByRole('table').querySelector('thead')!;
      expect(thead.querySelectorAll('.blurred')).toHaveLength(0);
      expect(thead.closest('.blurred')).toBeNull();
    });

    it('blurs every other row, toggles off, and moves between students', async () => {
      const user = userEvent.setup();
      render(<App />);
      await screen.findByRole('table');
      await user.click(focusButton('Bravo'));
      expect(row('Bravo')).not.toHaveClass('blurred');
      expect(bodyRows().filter((r) => r.classList.contains('blurred'))).toHaveLength(5);
      expect(focusButton('Bravo')).toHaveAttribute('aria-pressed', 'true');

      await user.click(focusButton('Delta'));
      expect(row('Delta')).not.toHaveClass('blurred');
      expect(row('Bravo')).toHaveClass('blurred');
      expect(bodyRows().filter((r) => r.classList.contains('blurred'))).toHaveLength(5);

      await user.click(focusButton('Delta'));
      expect(blurredNames()).toEqual([]);
      expect(bodyRows()).toHaveLength(6);
    });

    it('is UI-only: no extra API request', async () => {
      const user = userEvent.setup();
      render(<App />);
      await screen.findByRole('table');
      const fetchMock = vi.mocked(fetch);
      const calls = fetchMock.mock.calls.length;
      await user.click(focusButton('Bravo'));
      await user.click(focusButton('Bravo'));
      expect(fetchMock.mock.calls).toHaveLength(calls);
    });
  });

  it('shows compact headers while keeping the original names in the tooltip', async () => {
    render(<App />);
    await screen.findByRole('table');
    const headers = within(screen.getByRole('table').querySelector('thead')!).getAllByRole(
      'columnheader',
    );
    const labels = headers.map((h) => h.textContent);
    expect(labels).toEqual(
      expect.arrayContaining(['Tarea 01', 'Tarea 02', 'Tarea 03', 'Examen 1', 'Examen 2', 'A/P']),
    );
    expect(screen.getByRole('columnheader', { name: 'Examen 1' })).toHaveAttribute(
      'title',
      expect.stringContaining('Examen 1'),
    );
    // the source data is untouched
    expect(complete.columns.map((c) => c.name)).toContain('Tarea 04 (not counted)');
  });
});

describe('compactActivityLabel', () => {
  it('maps position within the block to the compact label', () => {
    expect(compactActivityLabel('exams', 0)).toBe('Examen 1');
    expect(compactActivityLabel('exams', 1)).toBe('Examen 2');
    expect(compactActivityLabel('tasks', 0)).toBe('Tarea 01');
    expect(compactActivityLabel('tasks', 11)).toBe('Tarea 12');
    expect(compactActivityLabel('participation', 0)).toBe('A/P');
  });
});
