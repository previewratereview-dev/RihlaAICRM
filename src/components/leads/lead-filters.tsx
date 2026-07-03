import React, { useRef } from 'react';
import { Search, Filter, Upload, Download, Plus } from 'lucide-react';
import { LEAD_STATUS_OPTIONS, LEAD_SOURCE_OPTIONS, PRIORITY_OPTIONS } from '@/lib/constants';

interface LeadFiltersProps {
  searchTerm: string;
  onSearchChange: (term: string) => void;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  priorityFilter: string;
  onPriorityFilterChange: (value: string) => void;
  sourceFilter: string;
  onSourceFilterChange: (value: string) => void;
  onImport: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onExport: () => void;
  onCreate: () => void;
  canWrite?: boolean;
}

export function LeadFilters({
  searchTerm,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  priorityFilter,
  onPriorityFilterChange,
  sourceFilter,
  onSourceFilterChange,
  onImport,
  onExport,
  onCreate,
  canWrite = true,
}: LeadFiltersProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6 shrink-0">
      <div className="flex items-center gap-3 relative flex-1 max-w-md">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search travelers, bookings..."
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          aria-label="Search leads"
          className="w-full h-10 rounded-xl bg-card/80 border border-input pl-9 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all shadow-sm"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 self-end lg:self-auto text-sm">
        <div className="flex items-center gap-2 px-3 h-10 rounded-xl border border-input bg-card/80 text-foreground shadow-sm">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <select
            value={statusFilter}
            onChange={(e) => onStatusFilterChange(e.target.value)}
            aria-label="Filter by status"
            className="bg-transparent border-none focus:ring-0 cursor-pointer font-medium"
          >
            <option value="all">All Stages</option>
            {LEAD_STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>

          <select
            value={priorityFilter}
            onChange={(e) => onPriorityFilterChange(e.target.value)}
            aria-label="Filter by priority"
            className="bg-transparent border-none focus:ring-0 cursor-pointer font-medium"
          >
            <option value="all">All Priorities</option>
            {PRIORITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>

          <select
            value={sourceFilter}
            onChange={(e) => onSourceFilterChange(e.target.value)}
            aria-label="Filter by source"
            className="bg-transparent border-none focus:ring-0 cursor-pointer font-medium"
          >
            <option value="all">All Sources</option>
            {LEAD_SOURCE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {canWrite && (
          <button
            onClick={() => {
              const headers = [
                'Full Name', 'Business Name', 'Email', 'Phone', 'WhatsApp',
                'Budget', 'Deal Value', 'Priority', 'Lead Source', 'Status',
                'Destination', 'Trip Type', 'Travelers', 'Departure Date', 'Return Date',
                'Travel Class', 'Interested Service', 'Special Requests', 'Website', 'Industry',
                'LinkedIn', 'Pain Points', 'Source of Discovery',
              ];
              const example = [
                'John Smith', 'Smith Family Trust', 'john@example.com', '+1234567890', '+1234567890',
                '$15,000', '20000', 'high', 'website', 'inquiry_received',
                'Maldives', 'Family Vacation', '4', '2026-03-15', '2026-03-22',
                'business', 'Honeymoon Package', 'Vegetarian meals needed', 'example.com', 'Travel & Tourism',
                'linkedin.com/in/johnsmith', 'Overwhelmed by booking options', 'Google search',
              ];
              const csv = [headers.join(','), example.map(v => `"${v}"`).join(',')].join('\n');
              const blob = new Blob([csv], { type: 'text/csv' });
              const url = URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = url;
              link.download = 'leads_import_template.csv';
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
            }}
            aria-label="Download CSV template"
            className="inline-flex items-center gap-2 h-10 px-4 rounded-xl border border-input bg-card/80 hover:border-primary/40 text-foreground hover:text-primary transition-colors shadow-sm"
          >
            <Download className="h-4 w-4 text-foreground" />
            <span className="text-sm font-medium">Template</span>
          </button>
        )}

        {canWrite && (
          <button
            onClick={() => fileInputRef.current?.click()}
            aria-label="Import leads from CSV"
            className="inline-flex items-center gap-2 h-10 px-4 rounded-xl border border-input bg-card/80 hover:border-primary/40 text-foreground hover:text-primary transition-colors shadow-sm"
          >
            <Upload className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Import</span>
          </button>
        )}
        {canWrite && (
          <input
            type="file"
            ref={fileInputRef}
            accept=".csv"
            onChange={onImport}
            className="hidden"
          />
        )}

        <button
          onClick={onExport}
          aria-label="Export leads to CSV"
          className="inline-flex items-center gap-2 h-10 px-4 rounded-xl border border-input bg-card/80 hover:border-primary/40 text-foreground hover:text-primary transition-colors shadow-sm"
        >
          <Download className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Export</span>
        </button>

        {canWrite && (
          <button
            onClick={onCreate}
            aria-label="Create new booking"
            className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 active:scale-95 transition-all shadow-md shadow-primary/20"
          >
            <Plus className="h-4 w-4" />
            <span>Create Booking</span>
          </button>
        )}
      </div>
    </div>
  );
}
