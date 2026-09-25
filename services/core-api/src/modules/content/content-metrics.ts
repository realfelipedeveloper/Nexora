import { Injectable } from "@nestjs/common";
import type { ContentEntryReviewDecision, ContentEntryStatus } from "@nexora/schemas";

type PublicContentOperation = "detail" | "list";
type PublicContentOutcome = "hit" | "miss";
type CollaborationMutation = "assignment_created" | "assignment_deleted" | "comment_created";
type ContentRevisionComparisonOutcome = "invalid" | "not_found" | "success";
type ContentRevisionRestorationOutcome =
  | "invalid"
  | "not_found"
  | "precondition_failed"
  | "success";
type SectionMutation =
  | "placement_deleted"
  | "placement_saved"
  | "role_granted"
  | "role_revoked"
  | "section_created"
  | "section_deleted"
  | "section_updated";
type NavigationMutation =
  | "item_created"
  | "item_deleted"
  | "item_updated"
  | "menu_created"
  | "menu_deleted"
  | "menu_updated"
  | "redirect_created"
  | "redirect_deleted"
  | "route_created"
  | "route_deleted"
  | "route_updated";
type RoutingResolution = "alias" | "menu" | "redirect" | "route";
type PublicationOperation =
  | "cancelled"
  | "published"
  | "schedule_failed"
  | "scheduled"
  | "scheduled_published"
  | "scheduled_unpublished"
  | "unpublished";

@Injectable()
export class ContentMetrics {
  private preconditionFailures = 0;
  private readonly collaborationMutations = new Map<CollaborationMutation, number>();
  private readonly publicReads = new Map<string, number>();
  private readonly revisionComparisons = new Map<ContentRevisionComparisonOutcome, number>();
  private readonly revisionRestorations = new Map<ContentRevisionRestorationOutcome, number>();
  private readonly reviewDecisions = new Map<ContentEntryReviewDecision, number>();
  private readonly sectionMutations = new Map<SectionMutation, number>();
  private readonly navigationMutations = new Map<NavigationMutation, number>();
  private readonly routingResolutions = new Map<RoutingResolution, number>();
  private readonly publicationOperations = new Map<PublicationOperation, number>();
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

  recordSectionMutation(operation: SectionMutation) {
    this.sectionMutations.set(operation, (this.sectionMutations.get(operation) ?? 0) + 1);
  }

  recordNavigationMutation(operation: NavigationMutation) {
    this.navigationMutations.set(operation, (this.navigationMutations.get(operation) ?? 0) + 1);
  }

  recordRoutingResolution(result: RoutingResolution) {
    this.routingResolutions.set(result, (this.routingResolutions.get(result) ?? 0) + 1);
  }

  recordPublicationOperation(operation: PublicationOperation) {
    this.publicationOperations.set(operation, (this.publicationOperations.get(operation) ?? 0) + 1);
  }

  recordRevisionComparison(outcome: ContentRevisionComparisonOutcome) {
    this.revisionComparisons.set(outcome, (this.revisionComparisons.get(outcome) ?? 0) + 1);
  }

  recordRevisionRestoration(outcome: ContentRevisionRestorationOutcome) {
    this.revisionRestorations.set(outcome, (this.revisionRestorations.get(outcome) ?? 0) + 1);
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
    lines.push("# TYPE nexora_content_revision_comparisons_total counter");
    for (const [outcome, count] of [...this.revisionComparisons.entries()].sort()) {
      lines.push(`nexora_content_revision_comparisons_total{outcome="${outcome}"} ${count}`);
    }
    lines.push("# TYPE nexora_content_revision_restorations_total counter");
    for (const [outcome, count] of [...this.revisionRestorations.entries()].sort()) {
      lines.push(`nexora_content_revision_restorations_total{outcome="${outcome}"} ${count}`);
    }
    lines.push("# TYPE nexora_content_review_decisions_total counter");
    for (const [decision, count] of [...this.reviewDecisions.entries()].sort()) {
      lines.push(`nexora_content_review_decisions_total{decision="${decision}"} ${count}`);
    }
    lines.push("# TYPE nexora_section_mutations_total counter");
    for (const [operation, count] of [...this.sectionMutations.entries()].sort()) {
      lines.push(`nexora_section_mutations_total{operation="${operation}"} ${count}`);
    }
    lines.push("# TYPE nexora_navigation_mutations_total counter");
    for (const [operation, count] of [...this.navigationMutations.entries()].sort()) {
      lines.push(`nexora_navigation_mutations_total{operation="${operation}"} ${count}`);
    }
    lines.push("# TYPE nexora_routing_resolutions_total counter");
    for (const [result, count] of [...this.routingResolutions.entries()].sort()) {
      lines.push(`nexora_routing_resolutions_total{result="${result}"} ${count}`);
    }
    lines.push("# TYPE nexora_publication_operations_total counter");
    for (const [operation, count] of [...this.publicationOperations.entries()].sort()) {
      lines.push(`nexora_publication_operations_total{operation="${operation}"} ${count}`);
    }
    lines.push("# TYPE nexora_content_state_transitions_total counter");
    for (const [transition, count] of [...this.stateTransitions.entries()].sort()) {
      const [from, to] = transition.split(":");
      lines.push(`nexora_content_state_transitions_total{from="${from}",to="${to}"} ${count}`);
    }
    return `${lines.join("\n")}\n`;
  }
}
