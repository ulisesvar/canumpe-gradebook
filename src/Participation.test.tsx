// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import complete from './test/gradebookComplete.json';
import { App } from './App';
import type { GradebookContract } from './domain/contract';

/**
 * A fake Academic API behind the Gradebook backend's two routes. It plays the Academic API's part
 * (it stores observations and returns count / average / score in the refreshed gradebook) so the
 * tests can prove the Gradebook itself computes nothing: it only posts value 0..3 per student.
 */
const STUDENTS = [
  { id: 101, first: 'Alexander', last: 'García' },
  { id: 102, first: 'Juan', last: 'Hernández' },
  { id: 103, first: 'Pedro', last: 'López' },
  { id: 104, first: 'María', last: 'Díaz' },
];

interface Fake {
  posts: { student_id: number; value: number }[];
  observations: Map<number, number[]>;
  failFor: Set<number>;
  hold: { release: () => void } | null;
  gradebookFails: boolean;
}

function installFakeApi(source: 'api' | 'fixture' = 'api'): Fake {
  const fake: Fake = {
    posts: [],
    observations: new Map(),
    failFor: new Set(),
    hold: null,
    gradebookFails: false,
  };
  const data = (): GradebookContract => {
    const copy = structuredClone(complete) as unknown as GradebookContract;
    copy.students = STUDENTS.map((s, i) => {
      const base = structuredClone(copy.students[i]!);
      const values = fake.observations.get(s.id) ?? [];
      // The fake Academic API's own rule: no observations -> 0, otherwise the mean.
      const average = values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
      return {
        ...base,
        student_id: s.id,
        first_name: s.first,
        last_name: s.last,
        full_name: `${s.first} ${s.last}`,
        account_number: `A${s.id}`,
        participation: {
          participation_count: values.length,
          participation_average: average,
          participation_score_100: (average / 3) * 100,
        },
      };
    });
    return copy;
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/gradebook') {
        if (fake.gradebookFails) return new Response('{}', { status: 502 });
        return new Response(JSON.stringify({ source, data: data() }), { status: 200 });
      }
      if (url === '/api/participation') {
        const body = JSON.parse(String(init?.body)) as { student_id: number; value: number };
        fake.posts.push(body);
        if (fake.hold) {
          await new Promise<void>((resolve) => {
            fake.hold = { release: resolve };
          });
        }
        if (fake.failFor.has(body.student_id)) {
          return new Response(JSON.stringify({ error: 'api_unavailable', message: 'x' }), {
            status: 502,
          });
        }
        fake.observations.set(body.student_id, [
          ...(fake.observations.get(body.student_id) ?? []),
          body.value,
        ]);
        return new Response(JSON.stringify({ ok: true }), { status: 201 });
      }
      throw new Error(`unexpected request: ${url}`);
    }),
  );
  return fake;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openParticipation(source: 'api' | 'fixture' = 'api') {
  const fake = installFakeApi(source);
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole('table');
  await user.click(screen.getByRole('tab', { name: 'Participación' }));
  return { fake, user };
}

const group = (name: string) => screen.getByRole('radiogroup', { name: new RegExp(name) });
const pick = (user: ReturnType<typeof userEvent.setup>, name: string, value: number) =>
  user.click(within(group(name)).getByRole('radio', { name: String(value) }));
const submitButton = () =>
  screen.getByRole('button', { name: /Registrar participación|Registrando/ });
const rowOf = (name: string) =>
  within(screen.getByRole('table', { name: /Captura de participación/ }))
    .getAllByRole('row')
    .find((r) => r.textContent?.includes(name))!;

describe('Participación tab', () => {
  it('is a separate view; the grades table is still the default one', async () => {
    installFakeApi();
    render(<App />);
    await screen.findByRole('table');

    expect(screen.getByRole('tab', { name: 'Calificaciones' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Participación' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    // only the grades table is visible until the tab is opened
    expect(screen.queryByRole('table', { name: /Captura de participación/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Registrar participación' })).toBeNull();
  });

  it('A. starts empty: no control selected, no "no participation" option, nothing to send', async () => {
    await openParticipation();

    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(STUDENTS.length * 4);
    expect(radios.filter((r) => r.getAttribute('aria-checked') === 'true')).toHaveLength(0);
    expect(radios.map((r) => r.textContent)).toEqual(STUDENTS.flatMap(() => ['0', '1', '2', '3']));
    expect(submitButton()).toBeDisabled();
    expect(screen.getByText('Ningún alumno seleccionado')).toBeInTheDocument();
  });

  it('lists every student with name, account and the current count / average / score', async () => {
    const { fake, user } = await openParticipation();
    fake.observations.set(101, [2, 1]);
    await pick(user, 'Pedro', 1);
    await user.click(screen.getByRole('button', { name: 'Registrar participación' }));
    await waitFor(() =>
      expect(within(rowOf('Pedro López')).getAllByRole('cell')[1]).toHaveTextContent('1'),
    );

    for (const s of STUDENTS) {
      expect(rowOf(`${s.first} ${s.last}`)).toHaveTextContent(`A${s.id}`);
    }
    // Pedro now has one observation of 1 -> average 1.00, score 33.33 (values from the API)
    expect(
      within(rowOf('Pedro López'))
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['A103', '1', '1.00', '33.33', expect.any(String)]);
  });

  it('B. selecting 0 sends value 0 (a real zero)', async () => {
    const { fake, user } = await openParticipation();

    await pick(user, 'María', 0);
    expect(within(group('María')).getByRole('radio', { name: '0' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await user.click(submitButton());

    await waitFor(() => expect(fake.posts).toEqual([{ student_id: 104, value: 0 }]));
  });

  it.each([1, 2, 3])('D. value %i is sent exactly', async (value) => {
    const { fake, user } = await openParticipation();

    await pick(user, 'Juan', value);
    await user.click(submitButton());

    await waitFor(() => expect(fake.posts).toEqual([{ student_id: 102, value }]));
  });

  it('C. + E. a capture records every selected student and nobody else', async () => {
    const { fake, user } = await openParticipation();

    await pick(user, 'Alexander', 2);
    await pick(user, 'Juan', 3);
    // Pedro stays empty
    await pick(user, 'María', 0);
    expect(screen.getByText('3 alumnos seleccionados')).toBeInTheDocument();
    await user.click(submitButton());

    expect(await screen.findByRole('status')).toHaveTextContent('Se registraron 3 observaciones.');
    expect(fake.posts).toHaveLength(3);
    expect(fake.posts).toEqual(
      expect.arrayContaining([
        { student_id: 101, value: 2 },
        { student_id: 102, value: 3 },
        { student_id: 104, value: 0 },
      ]),
    );
    expect(fake.posts.map((p) => p.student_id)).not.toContain(103); // Pedro: no observation
    expect(fake.observations.has(103)).toBe(false);
  });

  it('C. clicking the selected value again clears it: an empty control sends nothing', async () => {
    const { fake, user } = await openParticipation();

    await pick(user, 'Pedro', 2);
    expect(submitButton()).toBeEnabled();
    await pick(user, 'Pedro', 2);

    expect(within(group('Pedro')).getByRole('radio', { name: '2' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(submitButton()).toBeDisabled();
    expect(fake.posts).toHaveLength(0);
  });

  it('clears the captured controls after a successful capture', async () => {
    const { user } = await openParticipation();

    await pick(user, 'Alexander', 2);
    await user.click(submitButton());
    await screen.findByRole('status');

    expect(
      screen.getAllByRole('radio').filter((r) => r.getAttribute('aria-checked') === 'true'),
    ).toHaveLength(0);
    expect(submitButton()).toBeDisabled();
  });

  it('F. recording the same student again is a SECOND observation, not a replacement', async () => {
    const { fake, user } = await openParticipation();

    // first capture: Alexander 2, Juan 3
    await pick(user, 'Alexander', 2);
    await pick(user, 'Juan', 3);
    await user.click(submitButton());
    await screen.findByText('Se registraron 2 observaciones.');
    // second capture: Alexander 1, Pedro 2
    await pick(user, 'Alexander', 1);
    await pick(user, 'Pedro', 2);
    await user.click(submitButton());
    await screen.findByText('Se registraron 2 observaciones.');

    expect(fake.posts).toEqual([
      { student_id: 101, value: 2 },
      { student_id: 102, value: 3 },
      { student_id: 101, value: 1 },
      { student_id: 103, value: 2 },
    ]);
    expect(fake.observations.get(101)).toEqual([2, 1]); // two observations, never merged
    // The refreshed table shows what the Academic API computed: 2 observations, 1.50, 50.00.
    await waitFor(() =>
      expect(
        within(rowOf('Alexander García'))
          .getAllByRole('cell')
          .slice(1, 4)
          .map((c) => c.textContent),
      ).toEqual(['2', '1.50', '50.00']),
    );
  });

  it('acceptance: Alexander 2, Juan 3, Pedro empty, María 0 -> exactly three observations', async () => {
    const { fake, user } = await openParticipation();

    await pick(user, 'Alexander', 2);
    await pick(user, 'Juan', 3);
    await pick(user, 'María', 0);
    await user.click(screen.getByRole('button', { name: 'Registrar participación' }));
    await screen.findByRole('status');

    expect([...fake.observations.entries()].sort()).toEqual([
      [101, [2]],
      [102, [3]],
      [104, [0]],
    ]);

    await pick(user, 'Alexander', 1);
    await user.click(screen.getByRole('button', { name: 'Registrar participación' }));
    await waitFor(() => expect(fake.observations.get(101)).toEqual([2, 1]));
  });

  it('G. reports a failure clearly, keeps the failed selection and records the rest', async () => {
    const { fake, user } = await openParticipation();
    fake.failFor.add(102);

    await pick(user, 'Alexander', 2);
    await pick(user, 'Juan', 3);
    await user.click(submitButton());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'Se registró 1 observación, pero falló el registro de 1 alumno',
    );
    expect(alert).toHaveTextContent('Juan Hernández');
    expect(alert).toHaveTextContent('No se pudo confirmar el registro');
    // Alexander was recorded and cleared; Juan failed and stays selected for a retry
    expect(within(group('Alexander')).getByRole('radio', { name: '2' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(within(group('Juan')).getByRole('radio', { name: '3' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    // retrying posts ONLY the failed student, so Alexander is not recorded twice
    fake.failFor.clear();
    await user.click(submitButton());
    await screen.findByText('Se registró 1 observación.');
    expect(fake.posts.filter((p) => p.student_id === 101)).toHaveLength(1);
    expect(fake.posts.filter((p) => p.student_id === 102)).toHaveLength(2);
  });

  it('G. when every request fails nothing is recorded and all selections are kept', async () => {
    const { fake, user } = await openParticipation();
    fake.failFor = new Set([101, 104]);

    await pick(user, 'Alexander', 1);
    await pick(user, 'María', 0);
    await user.click(submitButton());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('No se registró ninguna observación');
    expect(fake.observations.size).toBe(0);
    expect(
      screen.getAllByRole('radio').filter((r) => r.getAttribute('aria-checked') === 'true'),
    ).toHaveLength(2);
  });

  it('H. the button is disabled while processing, so a double click records once', async () => {
    const { fake, user } = await openParticipation();
    fake.hold = { release: () => {} };

    await pick(user, 'Alexander', 2);
    const button = submitButton();
    await user.click(button);
    await waitFor(() => expect(submitButton()).toBeDisabled());
    expect(submitButton()).toHaveTextContent('Registrando…');
    await user.click(submitButton()); // second click while the first is in flight
    expect(within(group('Alexander')).getByRole('radio', { name: '2' })).toBeDisabled();
    expect(fake.posts).toHaveLength(1);

    const held = fake.hold;
    fake.hold = null;
    held.release();
    await screen.findByText('Se registró 1 observación.');
    expect(fake.posts).toHaveLength(1);
    expect(fake.observations.get(101)).toEqual([2]);
  });

  it('keeps the captured values when switching tabs', async () => {
    const { user } = await openParticipation();

    await pick(user, 'Juan', 3);
    await user.click(screen.getByRole('tab', { name: 'Calificaciones' }));
    expect(screen.getByRole('table')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Participación' }));

    expect(within(group('Juan')).getByRole('radio', { name: '3' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('says so when the observations were recorded but the table could not be reloaded', async () => {
    const { fake, user } = await openParticipation();

    await pick(user, 'Alexander', 2);
    fake.gradebookFails = true;
    await user.click(submitButton());

    expect(await screen.findByRole('status')).toHaveTextContent(
      /Se registró 1 observación\..*No se pudo actualizar la tabla/,
    );
    expect(fake.observations.get(101)).toEqual([2]);
  });

  it('fixture mode is read-only: controls and button are disabled and nothing is sent', async () => {
    const { fake } = await openParticipation('fixture');

    expect(screen.getAllByText(/Modo FIXTURE/)).not.toHaveLength(0);
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
    expect(submitButton()).toBeDisabled();
    expect(fake.posts).toHaveLength(0);
  });
});
