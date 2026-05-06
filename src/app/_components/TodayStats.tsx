import "./TodayStats.css";

interface Props {
  newSinceLastVisit: number;
  draftsInProgress: number;
  sentThisMonth: number;
}

export function TodayStats({ newSinceLastVisit, draftsInProgress, sentThisMonth }: Props) {
  return (
    <div className="fp-today-stats">
      <span>
        <b>{newSinceLastVisit} new</b> since you last looked
      </span>
      <span>
        <b>{draftsInProgress}</b> drafts in progress
      </span>
      <span>
        <b>{sentThisMonth}</b> sent this month
      </span>
    </div>
  );
}
