import React, { useRef, useEffect } from 'react';
import { Check, Minus, Trash2, ArrowUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getStatusColor, getStatusLabel, getPriorityColor, formatCurrency, getInitials } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import type { Lead, User, LeadStatus } from '@/types';

const PAGE_SIZES = [10, 25, 50, 100];

interface LeadTableProps {
  paginatedLeads: Lead[];
  filteredLeadsCount: number;
  selectedLeadId: string | null;
  onSelectLead: (id: string) => void;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onBulkDelete: () => void;
  onBulkStatusChange: (status: LeadStatus) => void;
  team: User[];
  dataLoading: boolean;
  currentPage: number;
  totalPages: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  bulkStatusLoading: boolean;
}

export function LeadTable({
  paginatedLeads,
  filteredLeadsCount,
  selectedLeadId,
  onSelectLead,
  selectedIds,
  onToggleSelect,
  onSelectAll,
  onDeselectAll,
  onBulkDelete,
  onBulkStatusChange,
  team,
  dataLoading,
  currentPage,
  totalPages,
  pageSize,
  onPageChange,
  onPageSizeChange,
  bulkStatusLoading,
}: LeadTableProps) {
  const selectAllRef = useRef<HTMLInputElement>(null);
  const allSelected = paginatedLeads.length > 0 && paginatedLeads.every((l) => selectedIds.has(l.id));
  const someSelected = paginatedLeads.some((l) => selectedIds.has(l.id));

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected && !allSelected;
    }
  }, [someSelected, allSelected]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden border border-border/60 rounded-2xl bg-card/80 backdrop-blur-sm shadow-sm scrollbar-thin min-h-0">
      {dataLoading && paginatedLeads.length === 0 ? (
        <div className="p-6 space-y-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center gap-4 py-3">
              <Skeleton className="h-10 w-10 rounded-full shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-28" />
              </div>
              <Skeleton className="h-6 w-20 rounded-full" />
              <Skeleton className="h-6 w-16 rounded-full" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-6 w-14 rounded-lg" />
              <Skeleton className="h-8 w-8 rounded-full" />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex-1 overflow-auto min-h-0">
          <table className="w-full text-left border-collapse" role="grid" aria-label="Travel leads">
            <thead className="sticky top-0 bg-secondary/50 border-b border-border/60 z-10">
              <tr className="text-[10px] uppercase font-mono tracking-wider text-muted-foreground select-none">
                <th className="py-3.5 px-4 w-10">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    checked={allSelected}
                    onChange={() => allSelected ? onDeselectAll() : onSelectAll()}
                    className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
                    aria-label="Select all leads on this page"
                  />
                </th>
                <th className="py-3.5 px-5 font-bold" scope="col">Traveler</th>
                <th className="py-3.5 px-5 font-bold" scope="col">Destination</th>
                <th className="py-3.5 px-5 font-bold" scope="col">Stage</th>
                <th className="py-3.5 px-5 font-bold" scope="col">Priority</th>
                <th className="py-3.5 px-5 font-bold text-right" scope="col">Value</th>
                <th className="py-3.5 px-5 font-bold text-center" scope="col">AI Score</th>
                <th className="py-3.5 px-6 font-bold" scope="col">Assigned To</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40 text-sm">
              {paginatedLeads.map((lead) => (
                <tr
                  key={lead.id}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest('[data-no-select]')) return;
                    onSelectLead(lead.id);
                  }}
                  className={cn(
                    'hover:bg-secondary/30 transition-all cursor-pointer group',
                    selectedLeadId === lead.id ? 'bg-primary/5' : ''
                  )}
                >
                  <td className="py-3.5 px-4" data-no-select>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(lead.id)}
                      onChange={() => onToggleSelect(lead.id)}
                      className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
                      aria-label={`Select ${lead.fullName}`}
                    />
                  </td>
                  <td className="py-3.5 px-5 truncate">
                    <div className="flex flex-col min-w-0">
                      <span className="font-semibold text-foreground group-hover:text-primary transition-colors">{lead.fullName}</span>
                      <span className="text-xs text-muted-foreground font-mono mt-0.5">{lead.email}</span>
                    </div>
                  </td>
                  <td className="py-3.5 px-5 truncate">
                    <div className="flex flex-col min-w-0">
                      <span className="text-foreground font-medium">{lead.destination || lead.businessName}</span>
                      <span className="text-xs text-muted-foreground mt-0.5">{lead.country}</span>
                    </div>
                  </td>
                  <td className="py-3.5 px-5">
                    <span
                      style={{ borderColor: `${getStatusColor(lead.status)}33`, color: getStatusColor(lead.status) }}
                      className="px-3 py-1 rounded-full border bg-card font-mono text-[10px] uppercase font-semibold inline-block"
                    >
                      {getStatusLabel(lead.status)}
                    </span>
                  </td>
                  <td className="py-3.5 px-5">
                    <span
                      style={{ color: getPriorityColor(lead.priority) }}
                      className="font-semibold capitalize inline-flex items-center gap-2 font-mono text-xs"
                    >
                      <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: getPriorityColor(lead.priority) }} />
                      {lead.priority}
                    </span>
                  </td>
                  <td className="py-3.5 px-5 font-mono font-bold text-foreground">{formatCurrency(lead.dealValue)}</td>
                  <td className="py-3.5 px-5 text-center">
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-secondary/50 border border-border/60 text-xs font-mono text-foreground">
                      <span className="font-semibold">{lead.aiScore}%</span>
                    </div>
                  </td>
                  <td className="py-3.5 px-6">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/80 text-white text-[10px] font-bold font-mono shadow-sm">
                        {getInitials(team.find((t) => t.id === lead.assignedTo)?.fullName || 'Unassigned')}
                      </div>
                      <span className="text-foreground font-medium truncate">
                        {team.find((t) => t.id === lead.assignedTo)?.fullName || 'Unassigned'}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredLeadsCount === 0 && (
                <tr>
                  <td colSpan={8} className="py-16 text-center text-muted-foreground font-mono">
                    No travelers matched your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {(selectedIds.size > 0 || totalPages > 1 || true) && (
        <div className="shrink-0 flex items-center justify-between px-3 sm:px-5 py-3 border-t border-border/60 text-xs text-muted-foreground flex-wrap gap-2">
          {selectedIds.size > 0 ? (
            <div className="flex items-center gap-3">
              <span className="font-mono font-semibold text-foreground">{selectedIds.size} selected</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={onBulkDelete}
                  className="px-3 py-1.5 rounded-lg border border-red-500/30 text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer inline-flex items-center gap-1.5"
                  aria-label="Delete selected leads"
                >
                  <Trash2 className="h-3 w-3" /> Delete
                </button>
                {(['new', 'contacted', 'qualified', 'proposal', 'negotiation', 'closed_won', 'closed_lost'] as LeadStatus[]).map((status) => (
                  <button
                    key={status}
                    onClick={() => onBulkStatusChange(status)}
                    disabled={bulkStatusLoading}
                    className="px-2.5 py-1.5 rounded-lg border border-border/60 hover:bg-secondary/80 transition-colors cursor-pointer disabled:opacity-50 font-mono text-[10px]"
                    aria-label={`Move selected to ${status}`}
                  >
                    {getStatusLabel(status)}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <span className="font-mono">
              Showing {((currentPage - 1) * pageSize) + 1}–{Math.min(currentPage * pageSize, filteredLeadsCount)} of {filteredLeadsCount}
            </span>
          )}

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <label htmlFor="page-size-select" className="font-mono text-[10px] uppercase">Per page:</label>
              <select
                id="page-size-select"
                value={pageSize}
                onChange={(e) => onPageSizeChange(Number(e.target.value))}
                className="rounded-lg border border-border/60 bg-card px-2 py-1 text-xs font-mono cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary"
                aria-label="Results per page"
              >
                {PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>{size}</option>
                ))}
              </select>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => onPageChange(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-1.5 rounded-lg border border-border/60 hover:bg-secondary/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                  aria-label="Previous page"
                >
                  Prev
                </button>
                {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                  const page = i + 1;
                  return (
                    <button
                      key={page}
                      onClick={() => onPageChange(page)}
                      className={cn(
                        'px-3 py-1.5 rounded-lg border transition-colors cursor-pointer',
                        currentPage === page
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'border-border/60 hover:bg-secondary/80'
                      )}
                      aria-label={`Page ${page}`}
                      aria-current={currentPage === page ? 'page' : undefined}
                    >
                      {page}
                    </button>
                  );
                })}
                <button
                  onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
                  disabled={currentPage === totalPages}
                  className="px-3 py-1.5 rounded-lg border border-border/60 hover:bg-secondary/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                  aria-label="Next page"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
