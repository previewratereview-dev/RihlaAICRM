import React from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { leadSchema, type LeadFormData, LEAD_DEFAULTS } from '@/lib/schemas';
import { LEAD_SOURCE_OPTIONS, PRIORITY_OPTIONS } from '@/lib/constants';
import type { Lead, User } from '@/types';

interface LeadFormModalProps {
  isEdit: boolean;
  defaultValues: Partial<Lead>;
  csvImportMessage: string | null;
  team: User[];
  onSubmit: (data: LeadFormData) => void;
  onClose: () => void;
  onDismissCsvMessage: () => void;
  formError?: string | null;
  onValidationError?: (message: string) => void;
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-red-500 text-[10px] font-mono mt-0.5">{message}</p>;
}

export function LeadFormModal({
  isEdit,
  defaultValues,
  csvImportMessage,
  team,
  onSubmit,
  onClose,
  onDismissCsvMessage,
  formError,
  onValidationError,
}: LeadFormModalProps) {
  const { register, handleSubmit, formState: { errors } } = useForm<LeadFormData>({
    resolver: zodResolver(leadSchema) as Resolver<LeadFormData>,
    defaultValues: {
      ...LEAD_DEFAULTS,
      ...Object.fromEntries(
        Object.entries(defaultValues).filter(([, v]) => v !== undefined && v !== null)
      ),
      assignedTo: defaultValues.assignedTo || team[0]?.id || '',
    },
  });

  const inputClass = "h-10 rounded-xl bg-background border border-input px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10";
  const inputErrorClass = "h-10 rounded-xl bg-background border border-red-300 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100";
  const selectClass = "h-10 rounded-xl bg-background border border-input px-3 text-sm text-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10";
  const selectErrorClass = "h-10 rounded-xl bg-background border border-red-300 px-3 text-sm text-foreground focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100";
  const textareaClass = "rounded-xl bg-background border border-input p-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 resize-none";

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={isEdit ? 'Edit lead' : 'Create new lead'}
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        className="bg-popover/90 backdrop-blur-xl border border-border/60 w-full max-w-2xl rounded-2xl overflow-hidden flex flex-col shadow-2xl"
      >
        <div className="flex h-14 items-center justify-between px-5 border-b border-border/60 bg-secondary/50">
          <span className="font-heading font-bold text-foreground text-xs uppercase tracking-wider select-none">
            {isEdit ? 'Edit Booking Details' : 'New Booking Entry'}
          </span>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-secondary transition-all cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit, (errors) => {
          const firstError = Object.values(errors)[0];
          const msg = firstError?.message || 'Please fix the errors below';
          onValidationError?.(msg);
        })} className="flex-1 overflow-y-auto p-6 space-y-4 max-h-[75vh] scrollbar-thin text-sm text-foreground">
          {csvImportMessage && (
            <div className={`px-4 py-2 rounded-lg text-sm font-medium ${
              csvImportMessage.startsWith('Successfully')
                ? 'bg-green-50 border border-green-200 text-green-700'
                : 'bg-red-50 border border-red-200 text-red-700'
            }`}>
              {csvImportMessage}
              <button type="button" onClick={onDismissCsvMessage} className="ml-2 underline">dismiss</button>
            </div>
          )}

          {formError && (
            <div className="px-4 py-2 rounded-lg text-sm font-medium bg-red-50 border border-red-200 text-red-700">
              {formError}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-muted-foreground font-mono text-[10px] uppercase font-semibold tracking-wider">Traveler Name</label>
              <input
                type="text"
                placeholder="e.g. Richard Hendricks"
                {...register('fullName')}
                className={errors.fullName ? inputErrorClass : inputClass}
              />
              <FieldError message={errors.fullName?.message} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-muted-foreground font-mono text-[10px] uppercase font-semibold tracking-wider">Company / Group</label>
              <input
                type="text"
                placeholder="e.g. Pied Piper Inc"
                {...register('businessName')}
                className={errors.businessName ? inputErrorClass : inputClass}
              />
              <FieldError message={errors.businessName?.message} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-muted-foreground font-mono text-[10px] uppercase font-semibold tracking-wider">Email</label>
              <input
                type="email"
                placeholder="richard@piedpiper.com"
                {...register('email')}
                className={errors.email ? inputErrorClass : inputClass}
              />
              <FieldError message={errors.email?.message} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-muted-foreground font-mono text-[10px] uppercase font-semibold tracking-wider">Phone</label>
              <input
                type="text"
                placeholder="+1 555-0182"
                {...register('phone')}
                className={inputClass}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-muted-foreground font-mono text-[10px] uppercase font-semibold tracking-wider">WhatsApp</label>
              <input
                type="text"
                placeholder="+1 555-0182"
                {...register('whatsapp')}
                className={inputClass}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-muted-foreground font-mono text-[10px] uppercase font-semibold tracking-wider">Lead Source</label>
              <select {...register('leadSource')} className={selectClass}>
                {LEAD_SOURCE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-muted-foreground font-mono text-[10px] uppercase font-semibold tracking-wider">Priority</label>
              <select {...register('priority')} className={selectClass}>
                {PRIORITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-muted-foreground font-mono text-[10px] uppercase font-semibold tracking-wider">Assigned To</label>
              <select {...register('assignedTo')} className={errors.assignedTo ? selectErrorClass : selectClass}>
                {team.map((member) => (
                  <option key={member.id} value={member.id}>{member.fullName}</option>
                ))}
              </select>
              <FieldError message={errors.assignedTo?.message} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-muted-foreground font-mono text-[10px] uppercase font-semibold tracking-wider">Deal Value ($)</label>
              <input
                type="number"
                placeholder="5000"
                {...register('dealValue')}
                className={inputClass}
              />
              <FieldError message={errors.dealValue?.message} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-muted-foreground font-mono text-[10px] uppercase font-semibold tracking-wider">Travelers Count</label>
              <input
                type="text"
                placeholder="1"
                {...register('numberOfTravelers')}
                className={inputClass}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-muted-foreground font-mono text-[10px] uppercase font-semibold tracking-wider">Budget</label>
              <input
                type="text"
                placeholder="$5,000"
                {...register('budget')}
                className={inputClass}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-muted-foreground font-mono text-[10px] uppercase font-semibold tracking-wider">Destination</label>
            <input
              type="text"
              placeholder="e.g. Maldives"
              {...register('destination')}
              className={inputClass}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-muted-foreground font-mono text-[10px] uppercase font-semibold tracking-wider">Special Requests</label>
            <textarea
              placeholder="Dietary needs, accessibility requests..."
              {...register('specialRequests')}
              rows={2}
              className={textareaClass}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-muted-foreground font-mono text-[10px] uppercase font-semibold tracking-wider">Tags (comma separated)</label>
            <input
              type="text"
              placeholder="luxury, honeymoon, scuba"
              {...register('tags', {
                setValueAs: (v: unknown) => {
                  if (Array.isArray(v)) return v;
                  if (typeof v === 'string') return v.split(',').map((t: string) => t.trim()).filter(Boolean);
                  return [];
                },
              })}
              className={inputClass}
            />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-border/60">
            <button
              type="button"
              onClick={onClose}
              className="h-10 px-5 rounded-xl bg-background border border-input hover:border-primary/40 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="h-10 px-5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors cursor-pointer shadow-md shadow-primary/20"
            >
              {isEdit ? 'Save Changes' : 'Create Booking'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
