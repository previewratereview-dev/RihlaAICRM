'use client';

import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useCRMStore } from '@/hooks/use-crm-store';
import { Lead, Priority, LeadStatus, InquiryDirectoryItem } from '@/types';
import { AnimatePresence } from 'framer-motion';
import { LeadFilters } from '@/components/leads/lead-filters';
import { LeadTable } from '@/components/leads/lead-table';
import { LeadDetailDrawer } from '@/components/leads/lead-detail-drawer';
import { LeadFormModal } from '@/components/leads/lead-form-modal';
import { can } from '@/lib/permissions';
import type { LeadFormData } from '@/lib/schemas';
import { isNewInquiriesReadEnabled } from '@/lib/feature-flags';
import { scoped } from '@/lib/data/scoped';
import { InquiryDetailDrawer } from '@/components/inquiries/inquiry-detail-drawer';
import { Search, Loader2, RefreshCw, AlertTriangle, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import { EmptyState } from '@/components/ui/empty-state';
import { useAttention } from '@/hooks/use-attention';
import { AttentionBadge } from '@/components/attention';

// (Existing CSV_FIELD_MAP and functions omitted for brevity in thought, but included in output)
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

export interface InquiriesViewProps {
  useNewReadOverride?: boolean;
}

export function InquiriesView({ useNewReadOverride }: InquiriesViewProps = {}) {
  const isNewReadActive = useNewReadOverride ?? isNewInquiriesReadEnabled();

  const currentUser = useCRMStore((s) => s.currentUser);
  const leads = useCRMStore((s) => s.leads);
  const notes = useCRMStore((s) => s.notes);
  const activities = useCRMStore((s) => s.activities);
  const team = useCRMStore((s) => s.team);
  const addLead = useCRMStore((s) => s.addLead);
  const syncData = useCRMStore((s) => s.syncData);
  const updateLead = useCRMStore((s) => s.updateLead);
  const deleteLead = useCRMStore((s) => s.deleteLead);
  const addLeadNote = useCRMStore((s) => s.addLeadNote);
  const deleteLeadNote = useCRMStore((s) => s.deleteLeadNote);
  const globalSearchQuery = useCRMStore((s) => s.globalSearchQuery);
  const setGlobalSearchQuery = useCRMStore((s) => s.setGlobalSearchQuery);
  const dataLoading = useCRMStore((s) => s.dataLoading);
  const setActiveContext = useCRMStore((s) => s.setActiveContext);

  const [searchTerm, setSearchTerm] = useState('');
  const canWrite = can(currentUser?.role ?? 'viewer', 'leads:write');
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  
  // Legacy selected lead ID
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  
  // New Read states
  const [newInquiries, setNewInquiries] = useState<InquiryDirectoryItem[]>([]);
  const [isLoadingNew, setIsLoadingNew] = useState(false);
  const [errorNew, setErrorNew] = useState<string | null>(null);
  const [selectedInquiryId, setSelectedInquiryId] = useState<string | null>(null);
  const [refreshCounter, setRefreshCounter] = useState(0);

  // Sync selection to activeContext for Global Copilot (canonical public.inquiries.id only)
  useEffect(() => {
    const id = isNewReadActive ? selectedInquiryId : null;
    setActiveContext({ type: id ? 'inquiry' : 'none', id: id || null });
    return () => setActiveContext({ type: 'none', id: null });
  }, [selectedInquiryId, isNewReadActive, setActiveContext]);

  // Common Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Modals
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // CSV
  const [csvImportMessage, setCsvImportMessage] = useState<string | null>(null);
  const [csvPreview, setCsvPreview] = useState<{ headers: string[]; rows: string[][]; mapping: Record<string, number> } | null>(null);
  const [showCsvMapping, setShowCsvMapping] = useState(false);
  const [importProgress, setImportProgress] = useState<{ current: number; total: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [bulkStatusLoading, setBulkStatusLoading] = useState(false);

  const tenantId = currentUser?.tenantId;

  const {
    getSignalsForInquiry,
    refresh: refreshAttention,
  } = useAttention();

  const triggerRefresh = useCallback(() => {
    setRefreshCounter((c) => c + 1);
    refreshAttention();
  }, [refreshAttention]);

  useEffect(() => {
    let isCancelled = false;
    async function loadData() {
      if (!isNewReadActive || !tenantId) return;
      setIsLoadingNew(true);
      setErrorNew(null);
      try {
        const client = scoped(tenantId);
        const listData = await client.inquiries.list();
        if (!isCancelled) {
          setNewInquiries(listData);
        }
      } catch (err: unknown) {
        if (!isCancelled) {
          console.error('[InquiriesView] Failed to fetch new inquiries:', err);
          setErrorNew(err instanceof Error ? err.message : 'Failed to load inquiries');
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingNew(false);
        }
      }
    }
    loadData();
    return () => { isCancelled = true; };
  }, [isNewReadActive, tenantId, refreshCounter]);

  // Sync global search
  useEffect(() => {
    if (globalSearchQuery) {
      const query = globalSearchQuery;
      Promise.resolve().then(() => {
        setSearchTerm(query);
        setGlobalSearchQuery('');
      });
    }
  }, [globalSearchQuery, setGlobalSearchQuery]);

  // ==========================================
  // LEGACY PATH LOGIC
  // ==========================================
  const filteredLeads = useMemo(() => {
    return leads.filter((l) => {
      const isClosed = ['booking_confirmed', 'booking_lost', 'closed_won', 'closed_lost'].includes(l.status);
      if (isClosed) return false;

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

  const paginatedLeads = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredLeads.slice(start, start + pageSize);
  }, [filteredLeads, currentPage, pageSize]);

  const selectedLead = useMemo(() => leads.find((l) => l.id === selectedLeadId) || null, [leads, selectedLeadId]);
  const leadNotes = useMemo(() => (selectedLeadId ? notes[selectedLeadId] || [] : []), [notes, selectedLeadId]);
  const leadActivities = useMemo(() => (selectedLeadId ? activities[selectedLeadId] || [] : []), [activities, selectedLeadId]);

  // ==========================================
  // NEW READ LOGIC
  // ==========================================
  const filteredNewInquiries = useMemo(() => {
    return newInquiries.filter((inq) => {
      const isClosed = ['booking_confirmed', 'booking_lost', 'closed_won', 'closed_lost'].includes(inq.pipelineStage);
      if (isClosed) return false;

      const matchesSearch =
        inq.travelerDisplayName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (inq.travelerEmail || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (inq.travelerPhone || '').includes(searchTerm) ||
        (inq.destination || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        inq.pipelineStage.toLowerCase().replace('_', ' ').includes(searchTerm.toLowerCase()) ||
        (inq.leadSource || '').toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesStatus = statusFilter === 'all' || inq.pipelineStage === statusFilter;
      const matchesPriority = priorityFilter === 'all' || inq.priority === priorityFilter;
      const matchesSource = sourceFilter === 'all' || (inq.leadSource || '').toLowerCase() === sourceFilter.toLowerCase();
      return matchesSearch && matchesStatus && matchesPriority && matchesSource;
    });
  }, [newInquiries, searchTerm, statusFilter, priorityFilter, sourceFilter]);

  const paginatedNewInquiries = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredNewInquiries.slice(start, start + pageSize);
  }, [filteredNewInquiries, currentPage, pageSize]);

  const selectedInquiry = useMemo(() => newInquiries.find((i) => i.inquiryId === selectedInquiryId) || null, [newInquiries, selectedInquiryId]);
  const selectedInquiryNotes = useMemo(() => (selectedInquiry?.legacyLeadId ? notes[selectedInquiry.legacyLeadId] || [] : []), [notes, selectedInquiry]);
  const selectedInquiryActivities = useMemo(() => (selectedInquiry?.legacyLeadId ? activities[selectedInquiry.legacyLeadId] || [] : []), [activities, selectedInquiry]);

  const uniqueNewSources = useMemo(() => Array.from(new Set(newInquiries.map(i => i.leadSource).filter(Boolean))), [newInquiries]);

  // Ensure current page is valid
  const totalItems = isNewReadActive ? filteredNewInquiries.length : filteredLeads.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  useEffect(() => {
    if (currentPage > totalPages) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCurrentPage(totalPages);
    }
  }, [totalPages, currentPage]);

  // ==========================================
  // SHARED ACTIONS
  // ==========================================
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
      if (isNewReadActive) triggerRefresh();
      setIsAddModalOpen(false);
    } catch (err: unknown) {
      let msg = err instanceof Error ? err.message : 'Failed to create inquiry';
      if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'PGRST204') {
        msg = "Database schema cache is stale. Please reload schema cache.";
      }
      setFormError(msg);
    }
  };

  const handleSaveEditLead = async (data: LeadFormData) => {
    if (!editingLead) return;
    setFormError(null);
    try {
      await updateLead(editingLead.id, data as Lead);
      if (isNewReadActive) triggerRefresh();
      setIsEditModalOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save changes';
      setFormError(msg);
    }
  };

  const handleDeleteLeadLegacy = (id: string) => {
    if (confirm('Are you sure you want to delete this lead? This will also remove associated logs.')) {
      deleteLead(id);
      setSelectedLeadId(null);
      if (isNewReadActive) triggerRefresh();
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
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    if (isNewReadActive) {
      setSelectedIds(new Set(paginatedNewInquiries.map((l) => l.inquiryId)));
    } else {
      setSelectedIds(new Set(paginatedLeads.map((l) => l.id)));
    }
  }, [isNewReadActive, paginatedLeads, paginatedNewInquiries]);

  const handleDeselectAll = useCallback(() => setSelectedIds(new Set()), []);

  const handleBulkDelete = useCallback(() => {
    if (isNewReadActive) {
      // In new-read mode, this is ARCHIVE. 
      if (!confirm(`Archive ${selectedIds.size} inquiry(s)? They will be removed from active views.`)) return;
      
      const missingLegacyId = Array.from(selectedIds).some(inqId => {
        const inq = newInquiries.find(i => i.inquiryId === inqId);
        return !inq?.legacyLeadId;
      });
      
      if (missingLegacyId) {
        alert("Compatibility integrity error: One or more selected inquiries cannot be archived because they lack a legacyLeadId.");
        return;
      }
      
      for (const inqId of selectedIds) {
        const legacyId = newInquiries.find(i => i.inquiryId === inqId)?.legacyLeadId;
        if (legacyId) deleteLead(legacyId);
      }
      setSelectedIds(new Set());
      setSelectedInquiryId(null);
      triggerRefresh();
    } else {
      // Legacy
      if (!confirm(`Delete ${selectedIds.size} lead(s)? This cannot be undone.`)) return;
      for (const id of selectedIds) {
        deleteLead(id);
      }
      setSelectedIds(new Set());
      if (selectedLeadId && selectedIds.has(selectedLeadId)) setSelectedLeadId(null);
    }
  }, [isNewReadActive, selectedIds, newInquiries, deleteLead, selectedLeadId, triggerRefresh]);

  const handleBulkStatusChange = useCallback(async (status: LeadStatus) => {
    setBulkStatusLoading(true);
    if (isNewReadActive) {
      const missingLegacyId = Array.from(selectedIds).some(inqId => {
        const inq = newInquiries.find(i => i.inquiryId === inqId);
        return !inq?.legacyLeadId;
      });
      
      if (missingLegacyId) {
        alert("Compatibility integrity error: One or more selected inquiries cannot be updated because they lack a legacyLeadId.");
        setBulkStatusLoading(false);
        return;
      }

      for (const inqId of selectedIds) {
        const legacyId = newInquiries.find(i => i.inquiryId === inqId)?.legacyLeadId;
        if (legacyId) updateLead(legacyId, { status } as Partial<Lead>);
      }
      triggerRefresh();
    } else {
      for (const id of selectedIds) {
        updateLead(id, { status } as Partial<Lead>);
      }
    }
    setBulkStatusLoading(false);
    setSelectedIds(new Set());
  }, [isNewReadActive, selectedIds, newInquiries, updateLead, triggerRefresh]);

  const handleUpdateLeadLegacyFromNewRead = (legacyId: string, updates: Partial<Lead>) => {
    updateLead(legacyId, updates);
    triggerRefresh();
  };

  const handleDeleteNoteFromNewRead = (legacyId: string, noteId: string) => {
    deleteLeadNote(legacyId, noteId);
    // Not requiring a refresh for notes since it's via local store
  };

  // CSV Logic (mostly unchanged, just updated export to handle new read)
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

      const leadsPayload: Partial<Lead>[] = [];

      for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        if (values.length === 0 || !values[m.fullName || 0]) continue;

        const get = (field: string, fallback = '') => {
          const idx = m[field];
          return idx !== undefined && values[idx] !== undefined ? values[idx].replace(/^"|"$/g, '').trim() : fallback;
        };

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

        leadsPayload.push({
          fullName, businessName, email, phone, whatsapp,
          website: get('website', ''), industry: get('industry', ''), country: '', city: '',
          linkedin: get('linkedin', ''), instagram: get('instagram', ''),
          leadSource: leadSourceVal as Lead['leadSource'], employeeCount: get('employeeCount', ''),
          monthlyRevenue: get('monthlyRevenue', ''), currentSoftware: get('currentSoftware', ''),
          interestedService: service, painPoints, budget, status, priority, dealValue,
          assignedTo: currentUser?.id || '', tags: ['CSV Import'],
          lastContacted: '', nextFollowUp: '',
          tripType, destination, numberOfTravelers, departureDate, returnDate,
          duration: '', travelClass, specialRequests, sourceOfDiscovery: get('sourceOfDiscovery', ''),
        });
      }

      setImportProgress({ current: Math.floor(leadsPayload.length / 2), total: leadsPayload.length });

      try {
        const res = await fetch('/api/leads/bulk-import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ leads: leadsPayload }),
        });
        if (res.ok) {
          const data = await res.json();
          importCount = data.count || leadsPayload.length;
          await syncData();
        } else {
          for (const item of leadsPayload) {
            await addLead(item as Lead);
            importCount++;
          }
        }
      } catch {
        for (const item of leadsPayload) {
          await addLead(item as Lead);
          importCount++;
        }
      }

      setImportProgress(null);
      setCsvImportMessage(`Successfully processed ${importCount} leads!`);
      setShowCsvMapping(false);
      setCsvPreview(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (isNewReadActive) triggerRefresh();
    };
    reader.readAsText(file);
  };

  const handleExportCSV = () => {
    const escape = (val: unknown) => { if (val === undefined || val === null) return '""'; return `"${String(val).replace(/"/g, '""')}"`; };
    
    if (isNewReadActive) {
      const csvHeaders = [
        'Inquiry ID', 'Traveler', 'Email', 'Phone',
        'Destination', 'Stage', 'Priority', 'Expected Value', 'Currency',
        'Source', 'Assigned Agent ID', 'Last Contacted', 'Next Follow-up', 'Created At',
      ];
      const csvRows = filteredNewInquiries.map((i) => [
        escape(i.inquiryId), escape(i.travelerDisplayName), escape(i.travelerEmail), escape(i.travelerPhone),
        escape(i.destination), escape(i.pipelineStage), escape(i.priority), escape(i.expectedValue), escape(i.currency),
        escape(i.leadSource), escape(i.assignedAgentId), escape(i.lastContactedAt), escape(i.nextFollowUpAt), escape(i.createdAt),
      ].join(','));
      const csvContent = [csvHeaders.join(','), ...csvRows].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `state_ai_inquiries_export_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      const csvHeaders = [
        'ID', 'Full Name', 'Business Name', 'Email', 'Phone', 'WhatsApp',
        'Destination', 'Trip Type', 'Travelers', 'Departure Date', 'Return Date',
        'Travel Class', 'Budget', 'Deal Value', 'Priority', 'Status',
        'Lead Source', 'Interested Service', 'Assigned To', 'Created At',
      ];
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
    }
  };

  const formatStage = (stage: string) => {
    return stage
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const getAgentName = (agentId: string | null) => {
    if (!agentId) return 'Unassigned';
    const agent = team.find((u) => u.id === agentId);
    return agent ? agent.fullName : 'Unknown agent';
  };

  return (
    <div className="flex h-full w-full overflow-hidden relative select-none">
      <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleImportCSV} />
      <div className="flex-1 flex flex-col p-6 lg:p-8 overflow-hidden min-w-0">
        
        {/* Header / Filter Section */}
        {isNewReadActive ? (
          <div className="flex flex-col gap-4 mb-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
                  Inquiries {isLoadingNew && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                </h1>
                <p className="text-sm text-muted-foreground mt-1">Manage incoming travel requests and active sales opportunities.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                <button
                  onClick={triggerRefresh}
                  className="p-2 border rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors hidden sm:flex"
                  title="Refresh"
                >
                  <RefreshCw className="h-4 w-4" />
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3 py-2 text-sm font-medium border rounded-md hover:bg-accent transition-colors flex-1 sm:flex-none text-center"
                >
                  Import
                </button>
                <button
                  onClick={handleExportCSV}
                  className="px-3 py-2 text-sm font-medium border rounded-md hover:bg-accent transition-colors flex-1 sm:flex-none text-center"
                >
                  Export
                </button>
                {canWrite && (
                  <button
                    onClick={handleOpenAddModal}
                    className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-md shadow hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 flex-[2] sm:flex-none"
                  >
                    <Plus className="h-4 w-4" /> New Inquiry
                  </button>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search inquiries..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-sm bg-background border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 text-sm bg-background border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="all">All Stages</option>
                <option value="inquiry_received">Inquiry Received</option>
                <option value="initial_contact">Initial Contact</option>
                <option value="options_shared">Options Shared</option>
                <option value="consultation_booked">Consultation Booked</option>
                <option value="itinerary_sent">Itinerary Sent</option>
                <option value="follow_up">Follow Up</option>
                <option value="customizing_package">Customizing Package</option>
                <option value="booking_confirmed">Booking Confirmed</option>
                <option value="booking_lost">Booking Lost</option>
              </select>
              <select
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value)}
                className="px-3 py-2 text-sm bg-background border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50 capitalize"
              >
                <option value="all">All Priorities</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
              <select
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value)}
                className="px-3 py-2 text-sm bg-background border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="all">All Sources</option>
                {uniqueNewSources.map(src => (
                  <option key={src} value={src}>{src}</option>
                ))}
              </select>
            </div>
            
            {/* Bulk Actions Bar */}
            {selectedIds.size > 0 && (
              <div className="flex items-center justify-between p-3 bg-primary/10 border border-primary/20 rounded-md">
                <span className="text-sm font-medium text-primary">{selectedIds.size} selected</span>
                <div className="flex gap-2">
                  <select
                    onChange={(e) => {
                      if (e.target.value) {
                        handleBulkStatusChange(e.target.value as LeadStatus);
                        e.target.value = '';
                      }
                    }}
                    disabled={bulkStatusLoading}
                    className="px-3 py-1 text-sm bg-background border rounded-md text-foreground disabled:opacity-50"
                  >
                    <option value="">Change Stage...</option>
                    <option value="inquiry_received">Inquiry Received</option>
                    <option value="initial_contact">Initial Contact</option>
                    <option value="options_shared">Options Shared</option>
                    <option value="consultation_booked">Consultation Booked</option>
                    <option value="itinerary_sent">Itinerary Sent</option>
                    <option value="follow_up">Follow Up</option>
                    <option value="customizing_package">Customizing Package</option>
                    <option value="booking_confirmed">Booking Confirmed</option>
                    <option value="booking_lost">Booking Lost</option>
                  </select>
                  {canWrite && (
                    <button
                      onClick={handleBulkDelete}
                      className="px-3 py-1 text-sm font-medium text-destructive-foreground bg-destructive rounded-md hover:bg-destructive/90 transition-colors"
                    >
                      Archive Selected
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
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
        )}

        {/* Table Content */}
        {isNewReadActive ? (
          <div className="flex-1 overflow-auto rounded-md border bg-card">
            {errorNew ? (
              <div className="p-8 text-center text-destructive flex flex-col items-center">
                <AlertTriangle className="h-10 w-10 mb-4" />
                <h3 className="font-semibold text-lg mb-2">Error Loading Inquiries</h3>
                <p className="text-sm">{errorNew}</p>
              </div>
            ) : isLoadingNew && newInquiries.length === 0 ? (
              <div className="p-12 flex justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
            ) : paginatedNewInquiries.length === 0 ? (
              <EmptyState title="No inquiries found" description="Try adjusting your filters or create a new inquiry." />
            ) : (
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-muted-foreground uppercase bg-secondary/50 sticky top-0 z-10">
                  <tr>
                    <th className="px-4 py-3 w-10">
                      <input
                        type="checkbox"
                        className="rounded border-input text-primary focus:ring-primary"
                        checked={selectedIds.size === paginatedNewInquiries.length && paginatedNewInquiries.length > 0}
                        onChange={(e) => e.target.checked ? handleSelectAll() : handleDeselectAll()}
                      />
                    </th>
                    <th className="px-4 py-3 font-semibold text-foreground">Traveler</th>
                    <th className="px-4 py-3 font-semibold text-foreground">Destination</th>
                    <th className="px-4 py-3 font-semibold text-foreground">Stage</th>
                    <th className="px-4 py-3 font-semibold text-foreground">Priority</th>
                    <th className="px-4 py-3 font-semibold text-foreground text-right">Expected Value</th>
                    <th className="px-4 py-3 font-semibold text-foreground">Next Follow-up</th>
                    <th className="px-4 py-3 font-semibold text-foreground">Assigned To</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {paginatedNewInquiries.map((inq) => (
                    <tr
                      key={inq.inquiryId}
                      className={`hover:bg-muted/50 cursor-pointer transition-colors ${selectedIds.has(inq.inquiryId) ? 'bg-primary/5' : ''}`}
                      onClick={() => setSelectedInquiryId(inq.inquiryId)}
                    >
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="rounded border-input text-primary focus:ring-primary"
                          checked={selectedIds.has(inq.inquiryId)}
                          onChange={() => handleToggleSelect(inq.inquiryId)}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground flex items-center gap-1.5 flex-wrap">
                          <span>{inq.travelerDisplayName}</span>
                          <AttentionBadge signals={getSignalsForInquiry(inq.inquiryId)} />
                          {inq.identityReviewRequired && (
                            <span title={`Identity review pending: ${inq.identityReviewReason || 'Unknown reason'}`}>
                              <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {inq.travelerEmail ? inq.travelerEmail : (inq.travelerPhone ? inq.travelerPhone : '—')}
                        </div>
                      </td>
                      <td className="px-4 py-3">{inq.destination || '—'}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-xs font-medium">
                          {formatStage(inq.pipelineStage)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className={`h-2 w-2 rounded-full ${
                            inq.priority === 'urgent' ? 'bg-red-500' :
                            inq.priority === 'high' ? 'bg-amber-500' :
                            inq.priority === 'medium' ? 'bg-blue-500' :
                            'bg-slate-400'
                          }`} />
                          <span className="capitalize">{inq.priority}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {inq.expectedValue === null ? '—' : inq.expectedValue === 0 ? '₹0' : formatCurrency(inq.expectedValue)}
                      </td>
                      <td className="px-4 py-3">
                        {inq.nextFollowUpAt ? formatDate(inq.nextFollowUpAt) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {inq.assignedAgentId ? (
                            <>
                              <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-medium text-primary">
                                {getAgentName(inq.assignedAgentId).substring(0,2).toUpperCase()}
                              </div>
                              <span className="text-xs">{getAgentName(inq.assignedAgentId)}</span>
                            </>
                          ) : (
                            <span className="text-muted-foreground text-xs italic">Unassigned</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : (
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
            viewType="inquiries"
          />
        )}
        
        {/* Pagination Controls for New Read */}
        {isNewReadActive && filteredNewInquiries.length > 0 && (
          <div className="mt-4 flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              Showing <span className="font-medium">{(currentPage - 1) * pageSize + 1}</span> to <span className="font-medium">{Math.min(currentPage * pageSize, filteredNewInquiries.length)}</span> of <span className="font-medium">{filteredNewInquiries.length}</span> results
            </div>
            <div className="flex items-center gap-2">
              <select
                value={pageSize}
                onChange={(e) => handlePageSizeChange(Number(e.target.value))}
                className="mr-2 text-sm border rounded-md px-2 py-1 bg-background"
              >
                {[10, 25, 50, 100].map(s => (
                  <option key={s} value={s}>{s} per page</option>
                ))}
              </select>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="p-1 border rounded-md disabled:opacity-50 hover:bg-accent"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-sm px-2">Page {currentPage} of {totalPages}</span>
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="p-1 border rounded-md disabled:opacity-50 hover:bg-accent"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <AnimatePresence>
        {!isNewReadActive && selectedLead && (
          <LeadDetailDrawer
            lead={selectedLead}
            notes={leadNotes}
            activities={leadActivities}
            team={team}
            onClose={() => setSelectedLeadId(null)}
            onEdit={handleOpenEditModal}
            onDelete={handleDeleteLeadLegacy}
            onUpdateLead={updateLead}
            onAddNote={addLeadNote}
            onDeleteNote={deleteLeadNote}
            currentUser={currentUser}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isNewReadActive && selectedInquiry && (
          <InquiryDetailDrawer
            inquiry={selectedInquiry}
            notes={selectedInquiryNotes}
            activities={selectedInquiryActivities}
            team={team}
            onClose={() => setSelectedInquiryId(null)}
            onEditLegacy={handleOpenEditModal}
            onUpdateLegacy={handleUpdateLeadLegacyFromNewRead}
            onAddNote={addLeadNote}
            onDeleteNote={handleDeleteNoteFromNewRead}
            currentUser={currentUser}
            attentionSignals={selectedInquiry ? getSignalsForInquiry(selectedInquiry.inquiryId) : []}
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

      {/* CSV Mapping Modal */}
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
