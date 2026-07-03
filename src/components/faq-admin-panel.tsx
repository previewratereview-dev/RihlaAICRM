'use client';

import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Save } from 'lucide-react';
import { generateId } from '@/lib/utils';

interface FaqRow {
  id: string;
  category: string;
  question: string;
  answer: string;
  keywords: string[];
}

export function FaqAdminPanel() {
  const [faqs, setFaqs] = useState<FaqRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = () => {
    fetch('/api/faq')
      .then((r) => r.json())
      .then((data) => setFaqs(data.faqs || []))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const addFaq = () => {
    setFaqs([
      ...faqs,
      {
        id: `faq-${generateId()}`,
        category: 'General',
        question: '',
        answer: '',
        keywords: [],
      },
    ]);
  };

  const saveAll = async () => {
    setSaving(true);
    try {
      await fetch('/api/faq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ faqs }),
      });
    } finally {
      setSaving(false);
    }
  };

  const remove = (id: string) => setFaqs(faqs.filter((f) => f.id !== id));

  const update = (id: string, field: keyof FaqRow, value: string | string[]) => {
    setFaqs(faqs.map((f) => {
      if (f.id !== id) return f;
      if (field === 'keywords' && typeof value === 'string') {
        return { ...f, keywords: value.split(',').map((k) => k.trim()).filter(Boolean) };
      }
      return { ...f, [field]: value };
    }));
  };

  if (loading) return <p className="text-sm text-muted-foreground">Loading FAQs...</p>;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">Manage tenant FAQ entries for the AI chatbot.</p>
        <div className="flex gap-2">
          <button onClick={addFaq} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border text-sm">
            <Plus className="h-4 w-4" /> Add
          </button>
          <button onClick={saveAll} disabled={saving} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-semibold">
            <Save className="h-4 w-4" /> {saving ? 'Saving...' : 'Save All'}
          </button>
        </div>
      </div>
      {faqs.map((faq) => (
        <div key={faq.id} className="p-4 rounded-xl border border-border/60 space-y-2">
          <div className="flex gap-2">
            <input
              value={faq.category}
              onChange={(e) => update(faq.id, 'category', e.target.value)}
              placeholder="Category"
              className="h-9 flex-1 rounded-lg border px-2 text-sm"
            />
            <button onClick={() => remove(faq.id)} className="p-2 text-red-600 hover:bg-red-50 rounded-lg">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <input
            value={faq.question}
            onChange={(e) => update(faq.id, 'question', e.target.value)}
            placeholder="Question"
            className="w-full h-9 rounded-lg border px-2 text-sm"
          />
          <textarea
            value={faq.answer}
            onChange={(e) => update(faq.id, 'answer', e.target.value)}
            placeholder="Answer"
            rows={3}
            className="w-full rounded-lg border p-2 text-sm resize-none"
          />
          <input
            value={Array.isArray(faq.keywords) ? faq.keywords.join(', ') : ''}
            onChange={(e) => update(faq.id, 'keywords', e.target.value)}
            placeholder="Keywords (comma separated)"
            className="w-full h-9 rounded-lg border px-2 text-sm"
          />
        </div>
      ))}
    </div>
  );
}
