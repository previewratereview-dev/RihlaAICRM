import React from 'react';
import { User } from '@/types';
import { PipelineInquiryViewModel, PIPELINE_STAGES } from '@/types/pipeline';
import { MoreHorizontal, MapPin } from 'lucide-react';
import { cn, formatCurrency, getInitials } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';

interface PipelineTableProps {
  inquiries: PipelineInquiryViewModel[];
  onMoveToStage: (id: string, stageId: string) => void;
  team: User[];
}

export function PipelineTable({ inquiries, onMoveToStage, team }: PipelineTableProps) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden border border-border/60 rounded-2xl bg-card/80 backdrop-blur-sm shadow-sm scrollbar-thin min-h-0">
      <div className="flex-1 overflow-auto min-h-0">
        <table className="w-full text-left border-collapse">
          <thead className="sticky top-0 bg-secondary/50 border-b border-border/60 z-10">
            <tr className="text-[10px] uppercase font-mono tracking-wider text-muted-foreground select-none">
              <th className="py-3 px-4 font-bold">Inquiry</th>
              <th className="py-3 px-4 font-bold">Stage</th>
              <th className="py-3 px-4 font-bold">Time in Stage</th>
              <th className="py-3 px-4 font-bold">Next Follow-up</th>
              <th className="py-3 px-4 font-bold">Expected Value</th>
              <th className="py-3 px-4 font-bold">Assignee</th>
              <th className="py-3 px-4 font-bold text-right w-12"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40 text-sm">
            {inquiries.map((iq) => (
              <tr key={iq.id} className="hover:bg-muted/30 transition-colors group h-[var(--table-row-min-height)] cursor-pointer">
                <td className="py-3 px-4 align-top">
                  <div className="font-semibold text-foreground flex items-center gap-2">
                    {iq.displayName}
                    <div className={cn(
                      "h-1.5 w-1.5 rounded-full shrink-0",
                      iq.priority === 'urgent' ? 'bg-red-500' :
                      iq.priority === 'high' ? 'bg-orange-500' :
                      iq.priority === 'medium' ? 'bg-blue-400' : 'bg-muted-foreground'
                    )} title={`Priority: ${iq.priority}`} />
                  </div>
                  {iq.destination && (
                    <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5 max-w-[200px] truncate">
                      <MapPin className="h-3 w-3" />
                      {iq.destination}
                    </div>
                  )}
                </td>
                <td className="py-3 px-4 align-top">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-secondary/80 text-secondary-foreground border border-border/50">
                    {iq.stageName}
                  </span>
                </td>
                <td className="py-3 px-4 align-top text-muted-foreground text-xs">
                  {iq.timeInStageLabel}
                </td>
                <td className="py-3 px-4 align-top text-xs">
                  {iq.nextFollowUpAt ? (
                    <span className={new Date(iq.nextFollowUpAt) < new Date() ? 'text-red-500 font-medium' : 'text-muted-foreground'}>
                      {new Date(iq.nextFollowUpAt).toLocaleDateString()}
                    </span>
                  ) : (
                    <span className="text-muted-foreground/50">No follow-up</span>
                  )}
                </td>
                <td className="py-3 px-4 align-top text-foreground font-medium">
                  {iq.expectedValue !== null ? formatCurrency(iq.expectedValue) : <span className="text-muted-foreground/50 font-normal">Value not estimated</span>}
                </td>
                <td className="py-3 px-4 align-top">
                  {iq.assignedAgent ? (
                    <div className="flex items-center gap-2 text-xs">
                      <div className="h-5 w-5 rounded-full bg-primary/10 text-primary flex items-center justify-center font-medium shrink-0">
                        {getInitials(iq.assignedAgent.name)}
                      </div>
                      <span className="truncate max-w-[120px]">{iq.assignedAgent.name}</span>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground/50">Unassigned</span>
                  )}
                </td>
                <td className="py-3 px-4 align-top text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity cursor-pointer outline-none border-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1">
                      <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuItem>Open details</DropdownMenuItem>
                      <DropdownMenuItem>Schedule follow-up</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem>Assign agent...</DropdownMenuItem>
                      <DropdownMenuItem>Set priority...</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {PIPELINE_STAGES.map((s) => (
                        <DropdownMenuItem key={s.id} onClick={() => onMoveToStage(iq.id, s.id)}>
                          Move to {s.label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {inquiries.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-muted-foreground font-medium">No inquiries in pipeline.</p>
          </div>
        )}
      </div>
    </div>
  );
}
