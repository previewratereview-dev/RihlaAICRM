/**
 * Phase AI-5C.2: Deterministic Itinerary Structural Comparison
 * 
 * Computes exact structural differences between a base itinerary version
 * and an AI-proposed revision without relying on model arithmetic or text parsing.
 */

import type { ItineraryDay } from '@/lib/quotes-itineraries/types';
import type { AIItineraryDay } from './contracts';

export type ItineraryItemDiffChangeType = 'added' | 'removed' | 'modified' | 'unchanged';

export interface ItineraryItemDiff {
  itemId?: string;
  title: string;
  changeType: ItineraryItemDiffChangeType;
  details?: string;
  oldTitle?: string;
  newTitle?: string;
}

export interface ItineraryDayDiff {
  dayNumber: number;
  oldTitle?: string;
  newTitle?: string;
  status: 'added' | 'removed' | 'modified' | 'unchanged';
  itemDiffs: ItineraryItemDiff[];
}

export interface ItineraryStructuralDiff {
  dayDiffs: ItineraryDayDiff[];
  totalDaysOld: number;
  totalDaysNew: number;
  addedDaysCount: number;
  removedDaysCount: number;
  modifiedDaysCount: number;
  hasStructuralChanges: boolean;
}

/**
 * Deterministically compares base itinerary days with proposed revision days.
 */
export function calculateItineraryStructuralDiff(
  baseDays: ItineraryDay[],
  proposedDays: AIItineraryDay[]
): ItineraryStructuralDiff {
  const maxDays = Math.max(baseDays.length, proposedDays.length);
  const dayDiffs: ItineraryDayDiff[] = [];

  let addedDaysCount = 0;
  let removedDaysCount = 0;
  let modifiedDaysCount = 0;

  for (let i = 0; i < maxDays; i++) {
    const baseDay = baseDays[i];
    const proposedDay = proposedDays[i];

    if (!baseDay && proposedDay) {
      // Day was added
      addedDaysCount++;
      dayDiffs.push({
        dayNumber: proposedDay.dayNumber || i + 1,
        newTitle: proposedDay.title,
        status: 'added',
        itemDiffs: (proposedDay.items || []).map((item) => ({
          title: item.title,
          changeType: 'added',
          details: item.description || undefined,
        })),
      });
    } else if (baseDay && !proposedDay) {
      // Day was removed
      removedDaysCount++;
      dayDiffs.push({
        dayNumber: baseDay.dayNumber || i + 1,
        oldTitle: baseDay.title,
        status: 'removed',
        itemDiffs: (baseDay.items || []).map((item) => ({
          itemId: item.id,
          title: item.title,
          changeType: 'removed',
          details: item.description || undefined,
        })),
      });
    } else if (baseDay && proposedDay) {
      // Compare items within the day
      const itemDiffs: ItineraryItemDiff[] = [];
      const baseItems = baseDay.items || [];
      const proposedItems = proposedDay.items || [];

      // Simple matching by item index / title
      const maxItems = Math.max(baseItems.length, proposedItems.length);
      let dayHasChanges = baseDay.title !== proposedDay.title;

      for (let j = 0; j < maxItems; j++) {
        const bItem = baseItems[j];
        const pItem = proposedItems[j];

        if (!bItem && pItem) {
          dayHasChanges = true;
          itemDiffs.push({
            title: pItem.title,
            changeType: 'added',
            details: pItem.description || undefined,
          });
        } else if (bItem && !pItem) {
          dayHasChanges = true;
          itemDiffs.push({
            itemId: bItem.id,
            title: bItem.title,
            changeType: 'removed',
            details: bItem.description || undefined,
          });
        } else if (bItem && pItem) {
          const isModified =
            bItem.title !== pItem.title ||
            (bItem.description || '') !== (pItem.description || '') ||
            (bItem.startTime || '') !== (pItem.time || '');

          if (isModified) {
            dayHasChanges = true;
            itemDiffs.push({
              itemId: bItem.id,
              title: pItem.title,
              oldTitle: bItem.title,
              newTitle: pItem.title,
              changeType: 'modified',
              details: pItem.description || undefined,
            });
          } else {
            itemDiffs.push({
              itemId: bItem.id,
              title: bItem.title,
              changeType: 'unchanged',
            });
          }
        }
      }

      if (dayHasChanges) {
        modifiedDaysCount++;
      }

      dayDiffs.push({
        dayNumber: proposedDay.dayNumber || i + 1,
        oldTitle: baseDay.title,
        newTitle: proposedDay.title,
        status: dayHasChanges ? 'modified' : 'unchanged',
        itemDiffs,
      });
    }
  }

  const hasStructuralChanges =
    addedDaysCount > 0 || removedDaysCount > 0 || modifiedDaysCount > 0;

  return {
    dayDiffs,
    totalDaysOld: baseDays.length,
    totalDaysNew: proposedDays.length,
    addedDaysCount,
    removedDaysCount,
    modifiedDaysCount,
    hasStructuralChanges,
  };
}
