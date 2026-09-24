import { Injectable } from "@nestjs/common";
import type { ContentEntryReviewDecision, ContentEntryStatus } from "@nexora/schemas";

type PublicContentOperation = "detail" | "list";
type PublicContentOutcome = "hit" | "miss";
type CollaborationMutation = "assignment_created" | "assignment_deleted" | "comment_created";

@Injectable()
export class ContentMetrics {
  private preconditionFailures = 0;
  private readonly collaborationMutations = new Map<CollaborationMutation, number>();
  private readonly publicReads = new Map<string, number>();
  private readonly reviewDecisions = new Map<ContentEntryReviewDecision, number>();
  private readonly stateTransitions = new Map<string, number>();

  recordPreconditionFailure() {
    this.preconditionFailures += 1;
  }

  recordCollaborationMutation(operation: CollaborationMutation) {
    this.collaborationMutations.set(
      operation,
      (this.collaborationMutations.get(operation) ?? 0) + 1,
    );
  }

  recordPublicRead(operation: PublicContentOperation, outcome: PublicContentOutcome) {
    const key = `${operation}:${outcome}`;
    this.publicReads.set(key, (this.publicReads.get(key) ?? 0) + 1);
  }

  recordReviewDecision(decision: ContentEntryReviewDecision) {
    this.reviewDecisions.set(decision, (this.reviewDecisions.get(decision) ?? 0) + 1);
  }

  recordStateTransition(from: ContentEntryStatus, to: ContentEntryStatus) {
    const key = `${from}:${to}`;
    this.stateTransitions.set(key, (this.stateTransitions.get(key) ?? 0) + 1);
  }

  render() {
    const lines = [
      "# Nexora metrics baseline",
      "nexora_core_api_up 1",
      "# TYPE nexora_content_collaboration_mutations_total counter",
    ];
    for (const [operation, count] of [...this.collaborationMutations.entries()].sort()) {
      lines.push(`nexora_content_collaboration_mutations_total{operation="${operation}"} ${count}`);
    }
    lines.push(
      "# TYPE nexora_content_precondition_failures_total counter",
      `nexora_content_precondition_failures_total ${this.preconditionFailures}`,
      "# TYPE nexora_public_content_reads_total counter",
    );
    for (const [result, count] of [...this.publicReads.entries()].sort()) {
      const [operation, outcome] = result.split(":");
      lines.push(
        `nexora_public_content_reads_total{operation="${operation}",outcome="${outcome}"} ${count}`,
      );
    }
    lines.push("# TYPE nexora_content_review_decisions_total counter");
    for (const [decision, count] of [...this.reviewDecisions.entries()].sort()) {
      lines.push(`nexora_content_review_decisions_total{decision="${decision}"} ${count}`);
    }
    lines.push("# TYPE nexora_content_state_transitions_total counter");
    for (const [transition, count] of [...this.stateTransitions.entries()].sort()) {
      const [from, to] = transition.split(":");
      lines.push(`nexora_content_state_transitions_total{from="${from}",to="${to}"} ${count}`);
    }
    return `${lines.join("\n")}\n`;
  }
}
