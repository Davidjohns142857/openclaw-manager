import type {
  ClearBlockerInput,
  DetectBlockerInput,
  RequestHumanDecisionInput,
  ResolveHumanDecisionInput
} from "../shared/contracts.ts";

export interface ApiContractField {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

export interface ReservedMutationContract {
  contract_id: string;
  contract_state: "reserved";
  implementation_strategy: "feature_gated_minimal_mutation";
  owner: "ysq";
  feature_flag: "decision_lifecycle_v1" | "blocker_lifecycle_v1";
  method: "POST";
  path: string;
  summary: string;
  request_fields: ApiContractField[];
  response_envelope: "session_detail";
  emits_events: string[];
  invariants: string[];
  docs: string[];
}

export interface ApiContractIndex {
  version: string;
  contracts: ReservedMutationContract[];
}

function fieldsForRequestHumanDecisionInput(): ApiContractField[] {
  const example: RequestHumanDecisionInput = {
    summary: "Need a clear go/no-go decision."
  };

  void example;

  return [
    {
      name: "decision_id",
      type: "string",
      required: false,
      description: "Optional caller-supplied stable id; server may generate one if omitted."
    },
    {
      name: "summary",
      type: "string",
      required: true,
      description: "Human-readable statement of the decision that must be made."
    },
    {
      name: "urgency",
      type: "\"low\" | \"medium\" | \"high\" | \"critical\"",
      required: false,
      description: "Decision urgency; defaults may be server-defined later."
    },
    {
      name: "requested_by_ref",
      type: "string",
      required: false,
      description: "Actor ref that requested the decision."
    },
    {
      name: "requested_at",
      type: "string",
      required: false,
      description: "ISO timestamp for the request; server may fill it if omitted."
    },
    {
      name: "next_human_actions",
      type: "string[]",
      required: false,
      description: "Optional explicit next human steps shown in summary/focus surfaces."
    },
    {
      name: "metadata",
      type: "object",
      required: false,
      description: "Opaque extension bag for host or workflow-specific context."
    }
  ];
}

function fieldsForResolveHumanDecisionInput(): ApiContractField[] {
  const example: ResolveHumanDecisionInput = {
    resolution_summary: "User approved the next step."
  };

  void example;

  return [
    {
      name: "resolution_summary",
      type: "string",
      required: true,
      description: "Human-readable explanation of how the decision was resolved."
    },
    {
      name: "resolved_by_ref",
      type: "string",
      required: false,
      description: "Actor ref that resolved the decision."
    },
    {
      name: "resolved_at",
      type: "string",
      required: false,
      description: "ISO timestamp for the resolution; server may fill it if omitted."
    },
    {
      name: "next_machine_actions",
      type: "string[]",
      required: false,
      description: "Optional machine steps that become available after resolution."
    },
    {
      name: "next_human_actions",
      type: "string[]",
      required: false,
      description: "Optional follow-up human actions that still remain."
    },
    {
      name: "metadata",
      type: "object",
      required: false,
      description: "Opaque extension bag for host or workflow-specific context."
    }
  ];
}

function fieldsForDetectBlockerInput(): ApiContractField[] {
  const example: DetectBlockerInput = {
    type: "external_dependency",
    summary: "Need upstream approval before continuing."
  };

  void example;

  return [
    {
      name: "blocker_id",
      type: "string",
      required: false,
      description: "Optional caller-supplied stable id; server may generate one if omitted."
    },
    {
      name: "type",
      type: "string",
      required: true,
      description: "Normalized blocker kind such as external_dependency or missing_input."
    },
    {
      name: "summary",
      type: "string",
      required: true,
      description: "Human-readable explanation of what is blocking progress."
    },
    {
      name: "severity",
      type: "\"low\" | \"medium\" | \"high\" | \"critical\"",
      required: false,
      description: "Blocker severity; defaults may be server-defined later."
    },
    {
      name: "detected_by_ref",
      type: "string",
      required: false,
      description: "Actor ref that detected the blocker."
    },
    {
      name: "detected_at",
      type: "string",
      required: false,
      description: "ISO timestamp for detection; server may fill it if omitted."
    },
    {
      name: "next_human_actions",
      type: "string[]",
      required: false,
      description: "Optional explicit next human steps shown in summary/focus surfaces."
    },
    {
      name: "metadata",
      type: "object",
      required: false,
      description: "Opaque extension bag for host or workflow-specific context."
    }
  ];
}

function fieldsForClearBlockerInput(): ApiContractField[] {
  const example: ClearBlockerInput = {
    resolution_summary: "Upstream approval arrived."
  };

  void example;

  return [
    {
      name: "resolution_summary",
      type: "string",
      required: true,
      description: "Human-readable explanation of how the blocker was cleared."
    },
    {
      name: "cleared_by_ref",
      type: "string",
      required: false,
      description: "Actor ref that cleared the blocker."
    },
    {
      name: "cleared_at",
      type: "string",
      required: false,
      description: "ISO timestamp for clearing; server may fill it if omitted."
    },
    {
      name: "next_machine_actions",
      type: "string[]",
      required: false,
      description: "Optional machine steps that become available after clearing."
    },
    {
      name: "next_human_actions",
      type: "string[]",
      required: false,
      description: "Optional human follow-up actions that still remain."
    },
    {
      name: "metadata",
      type: "object",
      required: false,
      description: "Opaque extension bag for host or workflow-specific context."
    }
  ];
}

export function buildApiContractIndex(): ApiContractIndex {
  return {
    version: "phase-1.5-contracts",
    contracts: [
      {
        contract_id: "session_decision_request_v1",
        contract_state: "reserved",
        implementation_strategy: "feature_gated_minimal_mutation",
        owner: "ysq",
        feature_flag: "decision_lifecycle_v1",
        method: "POST",
        path: "/sessions/:session_id/decisions",
        summary: "Create a structured pending human decision on a session.",
        request_fields: fieldsForRequestHumanDecisionInput(),
        response_envelope: "session_detail",
        emits_events: ["human_decision_requested"],
        invariants: [
          "The session remains checkpoint-authoritative.",
          "Open decisions block auto-continue.",
          "The returned session must remain the canonical current-state view."
        ],
        docs: [
          "docs/decision-blocker-contract.md",
          "docs/decision-blocker-api-contract.md",
          "docs/interaction-contract.md"
        ]
      },
      {
        contract_id: "session_decision_resolve_v1",
        contract_state: "reserved",
        implementation_strategy: "feature_gated_minimal_mutation",
        owner: "ysq",
        feature_flag: "decision_lifecycle_v1",
        method: "POST",
        path: "/sessions/:session_id/decisions/:decision_id/resolve",
        summary: "Resolve a structured pending human decision on a session.",
        request_fields: fieldsForResolveHumanDecisionInput(),
        response_envelope: "session_detail",
        emits_events: ["human_decision_resolved"],
        invariants: [
          "Resolving a decision must not rewrite history logs.",
          "Decision resolution must flow back into session.activity and focus via canonical state.",
          "The returned session must remain the canonical current-state view."
        ],
        docs: [
          "docs/decision-blocker-contract.md",
          "docs/decision-blocker-api-contract.md",
          "docs/interaction-contract.md"
        ]
      },
      {
        contract_id: "session_blocker_detect_v1",
        contract_state: "reserved",
        implementation_strategy: "feature_gated_minimal_mutation",
        owner: "ysq",
        feature_flag: "blocker_lifecycle_v1",
        method: "POST",
        path: "/sessions/:session_id/blockers",
        summary: "Create a structured blocker on a session.",
        request_fields: fieldsForDetectBlockerInput(),
        response_envelope: "session_detail",
        emits_events: ["blocker_detected"],
        invariants: [
          "Blockers remain structured recovery-relevant state.",
          "Open blockers block auto-continue.",
          "The returned session must remain the canonical current-state view."
        ],
        docs: [
          "docs/decision-blocker-contract.md",
          "docs/decision-blocker-api-contract.md",
          "docs/interaction-contract.md"
        ]
      },
      {
        contract_id: "session_blocker_clear_v1",
        contract_state: "reserved",
        implementation_strategy: "feature_gated_minimal_mutation",
        owner: "ysq",
        feature_flag: "blocker_lifecycle_v1",
        method: "POST",
        path: "/sessions/:session_id/blockers/:blocker_id/clear",
        summary: "Clear a structured blocker on a session.",
        request_fields: fieldsForClearBlockerInput(),
        response_envelope: "session_detail",
        emits_events: ["blocker_cleared"],
        invariants: [
          "Clearing a blocker must not rewrite history logs.",
          "Blocker clearance must flow back into session.activity and focus via canonical state.",
          "The returned session must remain the canonical current-state view."
        ],
        docs: [
          "docs/decision-blocker-contract.md",
          "docs/decision-blocker-api-contract.md",
          "docs/interaction-contract.md"
        ]
      }
    ]
  };
}
