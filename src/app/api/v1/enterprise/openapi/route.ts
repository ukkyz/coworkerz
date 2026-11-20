import { NextRequest, NextResponse } from "next/server";
import { resolveApiPrincipal } from "@/lib/access";

export const dynamic = "force-dynamic";

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: HEADERS });
}

export async function GET(req: NextRequest) {
  // The document enumerates the whole enterprise surface; it is not a public asset.
  const auth = await resolveApiPrincipal(req);
  if (auth.error) {
    return NextResponse.json(
      { error: auth.error },
      {
        status: auth.status ?? (auth.principal.authType === "api-key" ? 403 : 401),
        headers: HEADERS,
      },
    );
  }
  const origin = req.nextUrl.origin;

  const openAiTools = [
    {
      type: "function",
      function: {
        name: "enterprise_knowledge_retrieve",
        description:
          "Hybrid search (BM25 + 128d semantic vectors + SKOS taxonomy expansion + multi-hop cross-domain Knowledge Graph) across Aether's ACL-governed Enterprise Knowledge Bases. Strictly isolated from conversational agent memory. Call `POST /api/v1/enterprise/retrieve`.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Domain-specific or cross-domain enterprise question.",
            },
            domains: {
              type: "array",
              items: {
                type: "string",
                enum: [
                  "technology",
                  "finance",
                  "operations",
                  "governance",
                  "corporate_strategy",
                ],
              },
              description:
                "Optional list of domains to scope retrieval; omit for full cross-domain search.",
            },
            topK: { type: "integer", default: 5, minimum: 1, maximum: 12 },
            includeGraph: { type: "boolean", default: true },
            graphHops: { type: "integer", default: 2, minimum: 1, maximum: 3 },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "enterprise_graph_subgraph",
        description:
          "Retrieve a domain-specific Knowledge Graph subgraph or traverse cross-domain entity relationships with ACL enforcement. Call `GET /api/v1/enterprise/graph`.",
        parameters: {
          type: "object",
          properties: {
            domain: {
              type: "string",
              enum: [
                "ALL",
                "technology",
                "finance",
                "operations",
                "governance",
                "corporate_strategy",
              ],
            },
            includeBridges: {
              type: "boolean",
              default: true,
              description: "Include cross-domain relationships linked to this group.",
            },
            onlyCrossDomain: { type: "boolean", default: false },
            seed: {
              type: "string",
              description: "Optional entity keyword to expand multi-hop BFS from.",
            },
            hops: { type: "integer", default: 2, minimum: 1, maximum: 3 },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "enterprise_classify_document",
        description:
          "Auto-classify text against the formal Aether YAML/SKOS taxonomy scheme and extract domain-tagged Knowledge Graph entities/relationships (flagged for human review). Call `POST /api/v1/enterprise/classify` or ingest via `POST /api/v1/enterprise/documents`.",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string" },
            content: { type: "string" },
          },
          required: ["title", "content"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "enterprise_ingest_document",
        description:
          "Ingest a document into the domain-organized Enterprise Knowledge Base with ACLs, auto-classify against YAML/SKOS taxonomy, extract KG triples, and enqueue for CEO human review. Call `POST /api/v1/enterprise/documents`.",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string" },
            content: { type: "string" },
            docType: {
              type: "string",
              enum: [
                "policy",
                "architecture_rfc",
                "financial_model",
                "runbook",
                "board_memo",
                "regulatory_filing",
              ],
            },
            domainKey: {
              type: "string",
              enum: [
                "auto",
                "technology",
                "finance",
                "operations",
                "governance",
                "corporate_strategy",
              ],
            },
            classificationLevel: {
              type: "string",
              enum: ["public", "internal", "confidential", "board_restricted"],
            },
            aclReadRoles: {
              type: "array",
              items: {
                type: "string",
                description: "Executive ID from the live roster, CEO, EXTERNAL_AGENT, or * (still clearance-limited).",
              },
            },
          },
          required: ["title", "content"],
        },
      },
    },
  ];

  const anthropicTools = openAiTools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));

  const openapi = {
    openapi: "3.1.0",
    info: {
      title: "Aether Enterprise AI Knowledge & Memory Layer REST API",
      version: "1.0.0",
      description:
        "CEO-governed Enterprise Knowledge Layer combining domain-organized knowledge bases, role/clearance ACLs, formal YAML/SKOS/OWL taxonomy auto-classification with human review, hybrid BM25 + semantic vector + multi-hop cross-domain Knowledge Graph retrieval, Mermaid mindmap export, and a strictly isolated Conversational Agent Memory service.",
    },
    servers: [{ url: origin, description: "Active Aether Boardroom Instance" }],
    components: {
      securitySchemes: {
        BearerApiKey: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "aek_<token>",
          description: "Scoped API key minted in the CEO Knowledge OS console.",
        },
        HeaderApiKey: {
          type: "apiKey",
          in: "header",
          name: "X-API-Key",
        },
      },
    },
    security: [{ BearerApiKey: [] }, { HeaderApiKey: [] }],
    paths: {
      "/api/v1/enterprise/retrieve": {
        post: {
          operationId: "enterprise_knowledge_retrieve",
          summary: "Hybrid + SKOS + Cross-Domain GraphRAG Retrieval (ACL-Enforced)",
          tags: ["Enterprise Knowledge Plane"],
        },
        get: {
          operationId: "enterprise_knowledge_retrieve_get",
          summary: "Quick GET retrieval (?q=...&domains=...&includeGraph=true)",
          tags: ["Enterprise Knowledge Plane"],
        },
      },
      "/api/v1/enterprise/graph": {
        get: {
          operationId: "enterprise_graph_subgraph",
          summary: "Query domain subgraphs or cross-domain multi-hop subgraphs",
          tags: ["Enterprise Knowledge Plane"],
        },
        post: {
          operationId: "enterprise_graph_mutate",
          summary: "Create domain-tagged entity or relationship",
          tags: ["Enterprise Knowledge Plane"],
        },
      },
      "/api/v1/enterprise/documents": {
        get: {
          operationId: "enterprise_list_documents",
          summary: "List ACL-permitted enterprise documents by domain/review status",
          tags: ["Enterprise Knowledge Plane"],
        },
        post: {
          operationId: "enterprise_ingest_document",
          summary: "Ingest & auto-classify document against YAML/SKOS taxonomy (queued for human review)",
          tags: ["Enterprise Knowledge Plane"],
        },
      },
      "/api/v1/enterprise/documents/{id}": {
        get: {
          operationId: "enterprise_get_document",
          summary: "Fetch single document (ACL-checked)",
          tags: ["Enterprise Knowledge Plane"],
        },
        patch: {
          operationId: "enterprise_review_document",
          summary: "Human-in-the-loop review: approve/reject, override SKOS tags & ACLs",
          tags: ["Enterprise Knowledge Plane"],
        },
        delete: {
          operationId: "enterprise_delete_document",
          summary: "Delete document (CEO only)",
          tags: ["Enterprise Knowledge Plane"],
        },
      },
      "/api/v1/enterprise/taxonomy": {
        get: {
          operationId: "enterprise_get_taxonomy",
          summary: "Get formal taxonomy scheme (?format=json|yaml|skos-turtle)",
          tags: ["Taxonomy & Classification"],
        },
        put: {
          operationId: "enterprise_update_taxonomy",
          summary: "Update YAML/SKOS scheme and optionally re-classify corpus",
          tags: ["Taxonomy & Classification"],
        },
      },
      "/api/v1/enterprise/classify": {
        post: {
          operationId: "enterprise_classify_document",
          summary: "Zero-shot LLM + SKOS classify text and extract KG triples",
          tags: ["Taxonomy & Classification"],
        },
      },
      "/api/v1/enterprise/mindmap": {
        get: {
          operationId: "enterprise_get_mindmap",
          summary: "Get live Mermaid mindmap diagram (?format=json|mermaid)",
          tags: ["Visualization"],
        },
      },
      "/api/v1/agent-memory": {
        get: {
          operationId: "agent_memory_read",
          summary: "Strictly isolated Conversational Agent Memory service (requires canReadAgentMemory)",
          tags: ["Isolated Agent Memory Plane"],
        },
      },
    },
  };

  return NextResponse.json(
    {
      openapi,
      toolSchemas: {
        openaiAndOpencode: openAiTools,
        anthropic: anthropicTools,
      },
    },
    { headers: HEADERS }
  );
}
