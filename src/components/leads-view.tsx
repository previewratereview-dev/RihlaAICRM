'use client';

import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useCRMStore } from '@/hooks/use-crm-store';
import { Lead, Priority, LeadStatus } from '@/types';
import { AnimatePresence } from 'framer-motion';
import { LeadFilters } from '@/components/leads/lead-filters';
import { LeadTable } from '@/components/leads/lead-table';
import { LeadDetailDrawer } from '@/components/leads/lead-detail-drawer';
import { LeadFormModal } from '@/components/leads/lead-form-modal';
import { can } from '@/lib/permissions';
import type { LeadFormData } from '@/lib/schemas';

const CSV_FIELD_MAP = {
  fullName: ['name', 'fullname', 'contactname', 'leadname', 'full_name', 'traveler'],
  businessName: ['business', 'company', 'entity', 'business_name', 'group'],
  email: ['email', 'mail', 'e-mail'],
  phone: ['phone', 'mobile', 'tel', 'telephone', 'contact'],
  whatsapp: ['whatsapp', 'wa'],
  budget: ['budget', 'capital', 'fund'],
  service: ['service', 'interested', 'solution', 'interestedservice', 'serviceinterested'],
  painPoints: ['pain', 'problem', 'difficulty', 'painpoints', 'pain_points'],
  dealValue: ['deal', 'value', 'revenue', 'arr', 'dealvalue', 'deal_value'],
  priority: ['priority', 'importance'],
  leadSource: ['source', 'leadsource', 'discovery', 'channel', 'lead_source'],
  status: ['status', 'stage'],
  destination: ['destination', 'location', 'place', 'country', 'travel_to'],
  tripType: ['trip', 'triptype', 'trip_type', 'travel_type', 'vacation'],
  numberOfTravelers: ['travelers', 'travelergroup', 'numberoftravelers', 'group_size', 'pax'],
  departureDate: ['departure', 'depart', 'departuredate', 'start_date', 'start'],
  returnDate: ['return', 'returndate', 'end_date', 'end'],
  travelClass: ['class', 'travelclass', 'travel_class', 'flight_class'],
  specialRequests: ['requests', 'special', 'specialrequests', 'special_requests', 'notes'],
  website: ['website', 'url', 'site'],
  industry: ['industry', 'sector'],
  linkedin: ['linkedin', 'linkedin_url'],
  instagram: ['instagram', 'ig'],
  employeeCount: ['employees', 'employeesize', 'employee_count', 'team_size'],
  monthlyRevenue: ['revenue', 'monthlyrevenue', 'monthly_revenue', 'mrr'],
  currentSoftware: ['software', 'currentsoftware', 'current_software', 'tools'],
  sourceOfDiscovery: ['discovery', 'sourceofdiscovery', 'how_found', 'referral'],
};

export function LeadsView() {
  const currentUser = useCRMStore((s) => s.currentUser);
  const leads = useCRMStore((s) => s.leads);
  const notes = useCRMStore((s) => s.notes);
  const activities = useCRMStore((s) => s.activities);
  const team = useCRMStore((s) => s.team);
  const addLead = useCRMStore((s) => s.addLead);
  const updateLead = useCRMStore((s) => s.updateLead);
  const deleteLead = useCRMStore((s) => s.deleteLead);
  const addLeadNote = useCRMStore((s) => s.addLeadNote);
  const deleteLeadNote = useCRMStore((s) => s.deleteLeadNote);
  const globalSearchQuery = useCRMStore((s) => s.globalSearchQuery);
  const setGlobalSearchQuery = useCRMStore((s) => s.setGlobalSearchQuery);
  const dataLoading = useCRMStore((s) => s.dataLoading);

  const [searchTerm, setSearchTerm] = useState('');
  const canWrite = can(currentUser?.role ?? 'viewer', 'leads:write');
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [csvImportMessage, setCsvImportMessage] = useState<string | null>(null);
  const [csvPreview, setCsvPreview] = useState<{ headers: string[]; rows: string[][]; mapping: Record<string, number> } | null>(null);
  const [showCsvMapping, setShowCsvMapping] = useState(false);
  const [importProgress, setImportProgress] = useState<{ current: number; total: number } | null>(null);
  const [bulkStatusLoading, setBulkStatusLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedLead = useMemo(() => leads.find((l) => l.id === selectedLeadId) || null, [leads, selectedLeadId]);
  const leadNotes = useMemo(() => (selectedLeadId ? notes[selectedLeadId] || [] : []), [notes, selectedLeadId]);
  const leadActivities = useMemo(() => (selectedLeadId ? activities[selectedLeadId] || [] : []), [activities, selectedLeadId]);

  // Sync global search into local search state
  useEffect(() => {
    if (globalSearchQuery) {
      setSearchTerm(globalSearchQuery);
      setGlobalSearchQuery('');
    }
  }, [globalSearchQuery, setGlobalSearchQuery]);

  const filteredLeads = useMemo(() => {
    return leads.filter((l) => {
      const matchesSearch =
        l.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (l.businessName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        l.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (l.interestedService || '').toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = statusFilter === 'all' || l.status === statusFilter;
      const matchesPriority = priorityFilter === 'all' || l.priority === priorityFilter;
      const matchesSource = sourceFilter === 'all' || l.leadSource === sourceFilter;
      return matchesSearch && matchesStatus && matchesPriority && matchesSource;
    });
  }, [leads, searchTerm, statusFilter, priorityFilter, sourceFilter]);

  const totalPages = Math.ceil(filteredLeads.length / pageSize);
  const paginatedLeads = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredLeads.slice(start, start + pageSize);
  }, [filteredLeads, currentPage, pageSize]);

  const handleOpenAddModal = () => { setEditingLead(null); setFormError(null); setIsAddModalOpen(true); };

  const handleOpenEditModal = (lead: Lead) => {
    setEditingLead(lead);
    setFormError(null);
    setIsEditModalOpen(true);
  };

  const handleSubmitLead = async (data: LeadFormData) => {
    setFormError(null);
    try {
      await addLead(data as Lead);
      setIsAddModalOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create booking';
      setFormError(msg);
    }
  };

  const handleSaveEditLead = async (data: LeadFormData) => {
    if (!editingLead) return;
    setFormError(null);
    try {
      await updateLead(editingLead.id, data as Lead);
      setIsEditModalOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save changes';
      setFormError(msg);
    }
  };

  const handleDeleteLead = (id: string) => {
    if (confirm('Are you sure you want to delete this lead? This will also remove associated logs.')) {
      deleteLead(id);
      setSelectedLeadId(null);
    }
  };

  const handlePageSizeChange = useCallback((size: number) => {
    setPageSize(size);
    setCurrentPage(1);
    setSelectedIds(new Set());
  }, []);

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedIds(new Set(paginatedLeads.map((l) => l.id)));
  }, [paginatedLeads]);

  const handleDeselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const handleBulkDelete = useCallback(() => {
    if (!confirm(`Delete ${selectedIds.size} lead(s)? This cannot be undone.`)) return;
    for (const id of selectedIds) {
      deleteLead(id);
    }
    setSelectedIds(new Set());
    if (selectedLeadId && selectedIds.has(selectedLeadId)) setSelectedLeadId(null);
  }, [selectedIds, deleteLead, selectedLeadId]);

  const handleBulkStatusChange = useCallback(async (status: LeadStatus) => {
    setBulkStatusLoading(true);
    for (const id of selectedIds) {
      updateLead(id, { status } as Partial<Lead>);
    }
    setBulkStatusLoading(false);
    setSelectedIds(new Set());
  }, [selectedIds, updateLead]);

  const autoMapHeaders = (headers: string[]): Record<string, number> => {
    const mapping: Record<string, number> = {};
    const normalized = headers.map((h) => h.toLowerCase().replace(/["\s_\-]/g, ''));
    for (const [field, aliases] of Object.entries(CSV_FIELD_MAP)) {
      const idx = normalized.findIndex((h) => aliases.some((a) => h.includes(a)));
      if (idx !== -1) mapping[field] = idx;
    }
    return mapping;
  };

  const parseCSVLine = (line: string) => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') { inQuotes = !inQuotes; }
      else if (char === ',' && !inQuotes) { result.push(current.trim()); current = ''; }
      else { current += char; }
    }
    result.push(current.trim());
    return result;
  };

  const handleImportCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (!text) return;

      const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
      if (lines.length <= 1) {
        setCsvImportMessage('No valid leads found in CSV. Make sure it has a header row.');
        return;
      }

      const headers = parseCSVLine(lines[0]);
      const rows = lines.slice(1).map((line) => parseCSVLine(line));
      const mapping = autoMapHeaders(headers);

      setCsvPreview({ headers, rows: rows.slice(0, 5), mapping });
      setShowCsvMapping(true);
    };
    reader.readAsText(file);
  };

  const handleConfirmCsvImport = async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!csvPreview || !file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = event.target?.result as string;
      if (!text) return;

      const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
      const m = csvPreview.mapping;
      let importCount = 0;
      let errorCount = 0;
      const totalRows = lines.length - 1;

      setImportProgress({ current: 0, total: totalRows });

      for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        if (values.length === 0 || !values[m.fullName || 0]) {
          setImportProgress({ current: i, total: totalRows });
          continue;
        }

        const get = (field: string, fallback = '') => {
          const idx = m[field];
          return idx !== undefined && values[idx] !== undefined ? values[idx].replace(/^"|"$/g, '').trim() : fallback;
        };

        try {
          const fullName = get('fullName', values[0] || '');
          const businessName = get('businessName', '');
          const email = get('email', '');
          const phone = get('phone', '');
          const whatsapp = get('whatsapp', phone);
          const budget = get('budget', '');
          const service = get('service', '');
          const painPoints = get('painPoints', '');
          const dealValue = Number(get('dealValue', '0').replace(/[^0-9]/g, '')) || 0;
          const priorityVal = get('priority', 'medium').toLowerCase();
          const priority: Priority = ['low', 'medium', 'high', 'urgent'].includes(priorityVal) ? (priorityVal as Priority) : 'medium';
          const leadSourceVal = get('leadSource', 'website');
          const statusVal = get('status', 'new').toLowerCase();
          const status: LeadStatus = ['new', 'contacted', 'qualified', 'proposal', 'negotiation', 'inquiry_received', 'booking_confirmed', 'booking_lost'].includes(statusVal) ? (statusVal as LeadStatus) : 'new';
          const destination = get('destination', '');
          const tripType = get('tripType', 'Family Vacation');
          const numberOfTravelers = get('numberOfTravelers', '1');
          const departureDate = get('departureDate', '');
          const returnDate = get('returnDate', '');
          const travelClass = get('travelClass', 'economy');
          const specialRequests = get('specialRequests', '');

          await addLead({
            fullName, businessName, email, phone, whatsapp,
            website: get('website', ''), industry: get('industry', ''), country: '', city: '',
            linkedin: get('linkedin', ''), instagram: get('instagram', ''),
            leadSource: leadSourceVal, employeeCount: get('employeeCount', ''),
            monthlyRevenue: get('monthlyRevenue', ''), currentSoftware: get('currentSoftware', ''),
            interestedService: service, painPoints, budget, status, priority, dealValue,
            assignedTo: currentUser?.id || '', tags: ['CSV Import'],
            lastContacted: '', nextFollowUp: '',
            tripType, destination, numberOfTravelers, departureDate, returnDate,
            duration: '', travelClass, specialRequests, sourceOfDiscovery: get('sourceOfDiscovery', ''),
          } as Lead);
          importCount++;
        } catch {
          errorCount++;
        }

        setImportProgress({ current: i, total: totalRows });
      }

      setImportProgress(null);
      if (errorCount > 0) {
        setCsvImportMessage(`Imported ${importCount} leads. ${errorCount} rows failed (missing name or validation error).`);
      } else {
        setCsvImportMessage(`Successfully imported ${importCount} leads!`);
      }
      setShowCsvMapping(false);
      setCsvPreview(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsText(file);
  };

  const handleExportCSV = () => {
    const csvHeaders = [
      'ID', 'Full Name', 'Business Name', 'Email', 'Phone', 'WhatsApp',
      'Destination', 'Trip Type', 'Travelers', 'Departure Date', 'Return Date',
      'Travel Class', 'Budget', 'Deal Value', 'Priority', 'Status',
      'Lead Source', 'Interested Service', 'Assigned To', 'Created At',
    ];
    const escape = (val: unknown) => { if (val === undefined || val === null) return '""'; return `"${String(val).replace(/"/g, '""')}"`; };
    const csvRows = filteredLeads.map((l) => [
      escape(l.id), escape(l.fullName), escape(l.businessName), escape(l.email),
      escape(l.phone), escape(l.whatsapp), escape(l.destination), escape(l.tripType),
      escape(l.numberOfTravelers), escape(l.departureDate), escape(l.returnDate),
      escape(l.travelClass), escape(l.budget), escape(l.dealValue), escape(l.priority),
      escape(l.status), escape(l.leadSource), escape(l.interestedService),
      escape(l.assignedTo), escape(l.createdAt),
    ].join(','));
    const csvContent = [csvHeaders.join(','), ...csvRows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `state_ai_leads_export_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="flex h-full w-full overflow-hidden relative select-none">
      <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleImportCSV} />
      <div className="flex-1 flex flex-col p-6 lg:p-8 overflow-hidden min-w-0">
        <LeadFilters
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          priorityFilter={priorityFilter}
          onPriorityFilterChange={setPriorityFilter}
          sourceFilter={sourceFilter}
          onSourceFilterChange={setSourceFilter}
          onImport={() => fileInputRef.current?.click()}
          onExport={handleExportCSV}
          onCreate={handleOpenAddModal}
          canWrite={canWrite}
        />
        <LeadTable
          paginatedLeads={paginatedLeads}
          filteredLeadsCount={filteredLeads.length}
          selectedLeadId={selectedLeadId}
          onSelectLead={setSelectedLeadId}
          selectedIds={selectedIds}
          onToggleSelect={handleToggleSelect}
          onSelectAll={handleSelectAll}
          onDeselectAll={handleDeselectAll}
          onBulkDelete={handleBulkDelete}
          onBulkStatusChange={handleBulkStatusChange}
          team={team}
          dataLoading={dataLoading}
          currentPage={currentPage}
          totalPages={totalPages}
          pageSize={pageSize}
          onPageChange={setCurrentPage}
          onPageSizeChange={handlePageSizeChange}
          bulkStatusLoading={bulkStatusLoading}
        />
      </div>

      <AnimatePresence>
        {selectedLead && (
          <LeadDetailDrawer
            lead={selectedLead}
            notes={leadNotes}
            activities={leadActivities}
            team={team}
            onClose={() => setSelectedLeadId(null)}
            onEdit={handleOpenEditModal}
            onDelete={handleDeleteLead}
            onUpdateLead={updateLead}
            onAddNote={addLeadNote}
            onDeleteNote={deleteLeadNote}
            currentUser={currentUser}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {(isAddModalOpen || isEditModalOpen) && (
          <LeadFormModal
            isEdit={isEditModalOpen}
            defaultValues={editingLead || {}}
            csvImportMessage={csvImportMessage}
            team={team}
            onSubmit={isAddModalOpen ? handleSubmitLead : handleSaveEditLead}
            onClose={() => { setIsAddModalOpen(false); setIsEditModalOpen(false); setFormError(null); }}
            onDismissCsvMessage={() => setCsvImportMessage(null)}
            formError={formError}
            onValidationError={setFormError}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showCsvMapping && csvPreview && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm" onClick={() => setShowCsvMapping(false)}>
            <div
              className="bg-card border border-border/60 rounded-2xl shadow-xl p-6 max-w-2xl w-full mx-4 max-h-[85vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold text-foreground mb-1">Map CSV Columns</h3>
              <p className="text-sm text-muted-foreground mb-4">Review how your CSV columns map to lead fields. Adjust if needed.</p>

              <div className="space-y-3 mb-6">
                {Object.keys(CSV_FIELD_MAP).map((field) => (
                  <div key={field} className="flex items-center gap-3">
                    <label className="w-36 text-sm font-medium text-foreground capitalize">{field.replace(/([A-Z])/g, ' $1')}</label>
                    <select
                      value={csvPreview.mapping[field] ?? ''}
                      onChange={(e) => {
                        const val = e.target.value === '' ? undefined : Number(e.target.value);
                        setCsvPreview((prev) => prev ? { ...prev, mapping: { ...prev.mapping, ...(val !== undefined ? { [field]: val } : (() => { const m = { ...prev.mapping }; delete m[field]; return m; })()) } } : prev);
                      }}
                      className="flex-1 rounded-lg border border-border/60 bg-card px-3 py-1.5 text-sm font-mono cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      <option value="">-- Skip --</option>
                      {csvPreview.headers.map((h, idx) => (
                        <option key={idx} value={idx}>{h} (col {idx + 1})</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              <div className="mb-4">
                <h4 className="text-sm font-semibold text-foreground mb-2">Preview (first {csvPreview.rows.length} rows)</h4>
                <div className="overflow-x-auto border border-border/60 rounded-lg">
                  <table className="w-full text-xs font-mono">
                    <thead>
                      <tr className="bg-secondary/50 border-b border-border/60">
                        {csvPreview.headers.slice(0, 8).map((h, i) => (
                          <th key={i} className="px-3 py-2 text-left text-muted-foreground font-semibold">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {csvPreview.rows.map((row, ri) => (
                        <tr key={ri} className="hover:bg-secondary/30">
                          {row.slice(0, 8).map((cell, ci) => (
                            <td key={ci} className="px-3 py-2 text-foreground truncate max-w-[120px]">{cell}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => { setShowCsvMapping(false); setCsvPreview(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                  className="px-4 py-2 rounded-lg border border-border/60 text-sm font-medium hover:bg-secondary/80 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmCsvImport}
                  disabled={!!importProgress}
                  className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {importProgress ? `Importing ${importProgress.current}/${importProgress.total}...` : `Import ${csvPreview.rows.length}+ leads`}
                </button>
              </div>
              {importProgress && (
                <div className="mt-3">
                  <div className="w-full bg-secondary rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-primary h-full rounded-full transition-all duration-300"
                      style={{ width: `${Math.round((importProgress.current / importProgress.total) * 100)}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 text-right">{Math.round((importProgress.current / importProgress.total) * 100)}%</p>
                </div>
              )}
            </div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
