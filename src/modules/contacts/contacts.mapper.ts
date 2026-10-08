// Database model -> wire DTO mapping. The service layer owns this boundary so
// that repositories stay persistence-focused and controllers never see
// Prisma row shapes.

export interface ContactTagDto {
  id: string;
  name: string;
}

export interface ContactDto {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  tags: ContactTagDto[];
}

export interface PaginationDto {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PaginatedContactsDto {
  items: ContactDto[];
  pagination: PaginationDto;
}

export interface ContactActivityDto {
  id: string;
  type: "CONTACT_UPDATED" | "TAG_ADDED" | "TAG_REMOVED";
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

interface ContactRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  tags: Array<{ tag: { id: string; name: string } }>;
}

export function toContactDto(row: ContactRow): ContactDto {
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    phone: row.phone,
    company: row.company,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    tags: row.tags.map((relation) => ({ id: relation.tag.id, name: relation.tag.name })),
  };
}
