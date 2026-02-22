'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Source = {
  doc: string;
  rule?: string;
  section?: string;
  page?: string;
  quote?: string;
  link?: string;
};

type Question = {
  id: string;
  type: 'mcq';
  question: string;
  choices: string[];
  answerIndex: number;
  explanation?: string;
  source?: Source;
};

type WeekFile = {
  week: string; // technischer Key
  title: string; // Anzeige-Titel (deutsch)
  questions: Question[];
};

type IndexFile = {
  weeks: Array<{ file: string; week: string; title: string }>;
};

export default function Home() {
  const bucket = process.env.NEXT_PUBLIC_BUCKET_NAME!;
  const indexFile = process.env.NEXT_PUBLIC_INDEX_FILE || 'index.json';

  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<string>('');

  const [indexLoading, setIndexLoading] = useState(false);
  const [indexErr, setIndexErr] = useState('');
  const [weeks, setWeeks] = useState<IndexFile['weeks']>([]);
  const [selectedFile, setSelectedFile] = useState<string>('');

  const [loadingQ, setLoadingQ] = useState(false);
  const [week, setWeek] = useState<WeekFile | null>(null);
  const [loadErr, setLoadErr] = useState<string>('');

  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [showResult, setShowResult] = useState(false);

  // Statistik
  const [correctCount, setCorrectCount] = useState(0);
  const [answeredCount, setAnsweredCount] = useState(0);

  const current = useMemo(() => week?.questions?.[idx] ?? null, [week, idx]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserEmail(data.user?.email ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user?.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function sendMagicLink() {
    setMsg('');
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    setMsg(error ? error.message : 'Link gesendet. Bitte E-Mail prüfen und den Magic Link öffnen.');
  }

  async function logout() {
    await supabase.auth.signOut();
    setUserEmail(null);
    setWeek(null);
    setWeeks([]);
    setSelectedFile('');
    setIndexErr('');
    setLoadErr('');
    setIdx(0);
    setPicked(null);
    setShowResult(false);
    setCorrectCount(0);
    setAnsweredCount(0);
  }

  async function fetchJsonFromStorage(path: string): Promise<any> {
    // Prefer public URL (bucket is public)
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    let urlToFetch = data?.publicUrl;

    // Fallback signed URL (if later you switch bucket to private)
    if (!urlToFetch) {
      const { data: signed, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60);
      if (error || !signed?.signedUrl) throw new Error(error?.message || 'Signed URL konnte nicht erstellt werden.');
      urlToFetch = signed.signedUrl;
    }

    const res = await fetch(urlToFetch, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Abruf fehlgeschlagen (${res.status}) für ${path}`);
    return await res.json();
  }

  async function loadIndex() {
    setIndexLoading(true);
    setIndexErr('');
    setWeeks([]);
    setSelectedFile('');
    setWeek(null);
    setLoadErr('');
    setIdx(0);
    setPicked(null);
    setShowResult(false);
    setCorrectCount(0);
    setAnsweredCount(0);

    try {
      const json = (await fetchJsonFromStorage(indexFile)) as IndexFile;
      if (!json?.weeks || !Array.isArray(json.weeks)) {
        throw new Error('index.json ungültig. Erwartet: { "weeks": [ {file, week, title}, ... ] }');
      }
      setWeeks(json.weeks);
      setSelectedFile(json.weeks[0]?.file || '');
    } catch (e: any) {
      setIndexErr(e?.message || String(e));
    } finally {
      setIndexLoading(false);
    }
  }

  async function loadQuestions() {
    if (!selectedFile) return;

    setLoadingQ(true);
    setLoadErr('');
    setPicked(null);
    setShowResult(false);
    setIdx(0);
    setCorrectCount(0);
    setAnsweredCount(0);

    try {
      const json = (await fetchJsonFromStorage(selectedFile)) as WeekFile;

      if (!json || !Array.isArray(json.questions)) {
        throw new Error('JSON ungültig. Erwartet: { week, title, questions: [...] }.');
      }

      if (json.questions.length === 0) {
        throw new Error('Diese Rubrik enthält noch keine Fragen.');
      }

      setWeek(json);
    } catch (e: any) {
      setLoadErr(e?.message || String(e));
      setWeek(null);
    } finally {
      setLoadingQ(false);
    }
  }

  function submit() {
    if (picked === null || !current) return;

    if (!showResult) {
      setAnsweredCount((v) => v + 1);
      if (picked === current.answerIndex) setCorrectCount((v) => v + 1);
    }

    setShowResult(true);
  }

  function next() {
    setPicked(null);
    setShowResult(false);
    setIdx((v) => v + 1);
  }

  const progressLabel = useMemo(() => {
    if (!week) return '';
    return `Frage ${idx + 1} / ${week.questions.length}`;
  }, [week, idx]);

  const isLast = useMemo(() => {
    if (!week) return true;
    return idx >= week.questions.length - 1;
  }, [week, idx]);

  const percentCorrect = useMemo(() => {
    if (!week) return 0;
    const total = week.questions.length || 1;
    return Math.round((correctCount / total) * 100);
  }, [week, correctCount]);

  return (
    <main className="max-w-3xl mx-auto p-6 font-sans bg-white text-gray-900 min-h-screen">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold mb-1">
          Willkommen zur Schiedsrichter-Prüfungsvorbereitung (WAR &amp; WARB)
        </h1>
        <p className="text-sm opacity-70">
          Bitte gib deine E-Mail-Adresse unten ein. Du erhältst per E-Mail einen Link (Magic Link), um dich einzuloggen.
        </p>
        <p className="text-xs opacity-60 mt-2">
          Powered by <b>WHATIF..</b> · Garcia
        </p>
      </div>

      {!userEmail ? (
        <div className="border rounded-xl p-5 space-y-3">
          <p className="font-medium">Anmelden</p>
          <p className="text-sm opacity-70">
            1) E-Mail eingeben · 2) „Magic Link senden“ klicken · 3) E-Mail öffnen und den Link anklicken.
          </p>

          <input
            className="w-full border rounded p-2"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="deine.email@domain.com"
          />

          <button className="w-full bg-black text-white rounded p-2" onClick={sendMagicLink}>
            Magic Link senden
          </button>

          {msg && <p className="text-sm opacity-80">{msg}</p>}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <p>
              Eingeloggt als <b>{userEmail}</b>
            </p>
            <button className="border rounded px-3 py-2" onClick={logout}>
              Logout
            </button>
          </div>

          <div className="border rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold">Rubriken &amp; Fragenkataloge</h2>
              <button
                className="bg-black text-white rounded px-3 py-2 disabled:opacity-50"
                onClick={loadIndex}
                disabled={indexLoading}
              >
                {indexLoading ? 'Lädt…' : 'Liste laden'}
              </button>
            </div>

            {indexErr && <div className="text-sm text-red-600 whitespace-pre-wrap">{indexErr}</div>}

            {weeks.length > 0 && (
              <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
                <div className="w-full">
                  <label className="text-sm opacity-70">Rubrik auswählen</label>
                  <select
                    className="w-full border rounded p-2 mt-1"
                    value={selectedFile}
                    onChange={(e) => setSelectedFile(e.target.value)}
                  >
                    {weeks.map((w) => (
                      <option key={w.file} value={w.file}>
                        {w.title}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  className="bg-black text-white rounded px-4 py-2 disabled:opacity-50 h-10 mt-6 sm:mt-0"
                  onClick={loadQuestions}
                  disabled={loadingQ || !selectedFile}
                >
                  {loadingQ ? 'Lädt…' : 'Fragen laden'}
                </button>
              </div>
            )}

            {loadErr && <div className="text-sm text-red-600 whitespace-pre-wrap">{loadErr}</div>}

            {week && (
              <div className="text-sm opacity-80">
                <div className="font-medium">{week.title}</div>
                <div>Anzahl Fragen: {week.questions.length}</div>
              </div>
            )}
          </div>

          {week && current && (
            <div className="border rounded-xl p-6 space-y-4">
              <div className="flex items-center justify-between text-sm opacity-70">
                <div>{progressLabel}</div>
                <div className="text-right">
                  <div>
                    <b>{percentCorrect}%</b> richtig
                  </div>
                  <div className="opacity-70">
                    {correctCount} / {week.questions.length} (beantwortet: {answeredCount})
                  </div>
                </div>
              </div>

              <div className="text-lg font-medium">{current.question}</div>

              <div className="space-y-2">
                {current.choices.map((c, i) => {
                  const selected = picked === i;
                  const correct = showResult && i === current.answerIndex;
                  const wrongSelected = showResult && selected && i !== current.answerIndex;

                  const base =
                    'w-full text-left border rounded p-3 transition focus:outline-none focus:ring-2 focus:ring-black';
                  const normal = 'bg-white hover:bg-gray-50';
                  const selectedStyle = 'border-black bg-gray-100';
                  const correctStyle = 'border-green-600 bg-green-100';
                  const wrongStyle = 'border-red-600 bg-red-100';

                  const className = [
                    base,
                    normal,
                    selected ? selectedStyle : '',
                    correct ? correctStyle : '',
                    wrongSelected ? wrongStyle : '',
                  ]
                    .filter(Boolean)
                    .join(' ');

                  return (
                    <button
                      key={i}
                      className={className}
                      onClick={() => setPicked(i)}
                      disabled={showResult}
                      type="button"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span>{c}</span>
                        {selected && !showResult && (
                          <span className="text-xs font-semibold border border-black rounded px-2 py-1">
                            ✓ Ausgewählt
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="flex gap-2">
                <button
                  className="bg-black text-white rounded px-4 py-2 disabled:opacity-50"
                  onClick={submit}
                  disabled={picked === null || showResult}
                >
                  Prüfen
                </button>

                {showResult && !isLast && (
                  <button className="border rounded px-4 py-2" onClick={next}>
                    Weiter
                  </button>
                )}

                {showResult && isLast && (
                  <button
                    className="border rounded px-4 py-2"
                    onClick={() => {
                      setPicked(null);
                      setShowResult(false);
                      setIdx(0);
                      setCorrectCount(0);
                      setAnsweredCount(0);
                    }}
                  >
                    Neu starten
                  </button>
                )}
              </div>

              {showResult && (
                <div className="text-sm space-y-2">
                  <div className="font-medium">{picked === current.answerIndex ? '✅ Richtig' : '❌ Falsch'}</div>

                  {current.explanation && (
                    <div className="opacity-90">
                      <b>Begründung:</b> {current.explanation}
                    </div>
                  )}

                  {current.source && (
                    <div className="opacity-90">
                      <b>Wo zu finden:</b>{' '}
                      {[
                        current.source.rule,
                        current.source.section,
                        current.source.page ? `(${current.source.page})` : undefined,
                      ]
                        .filter(Boolean)
                        .join(' — ') || '—'}
                      <div className="opacity-70">
                        <b>Dokument:</b> {current.source.doc}
                      </div>

                      {current.source.quote && (
                        <div className="mt-2 border-l-4 pl-3 opacity-70">
                          „{current.source.quote}“
                        </div>
                      )}

                      {current.source.link && (
                        <div className="mt-2">
                          <a className="underline" href={current.source.link} target="_blank" rel="noreferrer">
                            Quelle öffnen
                          </a>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </main>
  );
}