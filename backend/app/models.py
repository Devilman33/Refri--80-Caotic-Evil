import enum
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def enum_values(enum_cls: type[enum.Enum]) -> list[str]:
    return [member.value for member in enum_cls]


class BoxType(str, enum.Enum):
    CARTON_81 = "carton_81"
    PLASTIC_100 = "plastic_100"


class SampleStatus(str, enum.Enum):
    ACTIVE = "active"
    WITHDRAWN = "withdrawn"


class MovementAction(str, enum.Enum):
    FREEZE = "freeze"
    THAW = "thaw"
    TRANSFER = "transfer"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    initials: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    owned_boxes: Mapped[list["Box"]] = relationship(back_populates="owner")
    owned_samples: Mapped[list["Sample"]] = relationship(
        back_populates="owner", foreign_keys="Sample.owner_id"
    )
    operated_movements: Mapped[list["Movement"]] = relationship(back_populates="operator")


class Section(Base):
    __tablename__ = "sections"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(4), unique=True)

    racks: Mapped[list["Rack"]] = relationship(back_populates="section", cascade="all, delete-orphan")


class Rack(Base):
    __tablename__ = "racks"
    __table_args__ = (UniqueConstraint("section_id", "letter", name="uq_racks_section_letter"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    section_id: Mapped[int] = mapped_column(ForeignKey("sections.id", ondelete="RESTRICT"), nullable=False)
    letter: Mapped[str] = mapped_column(String(1), nullable=False)

    section: Mapped[Section] = relationship(back_populates="racks")
    boxes: Mapped[list["Box"]] = relationship(back_populates="rack", cascade="all, delete-orphan")


class Box(Base):
    __tablename__ = "boxes"
    __table_args__ = (UniqueConstraint("rack_id", "number", name="uq_boxes_rack_number"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    rack_id: Mapped[int] = mapped_column(ForeignKey("racks.id", ondelete="RESTRICT"), nullable=False)
    number: Mapped[int] = mapped_column(Integer, nullable=False)
    type: Mapped[BoxType] = mapped_column(
        Enum(BoxType, name="box_type", values_callable=enum_values), nullable=False
    )
    historical_label: Mapped[str | None] = mapped_column(String(255))
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    rack: Mapped[Rack] = relationship(back_populates="boxes")
    owner: Mapped[User | None] = relationship(back_populates="owned_boxes")
    samples: Mapped[list["Sample"]] = relationship(back_populates="box")


class Sample(Base):
    __tablename__ = "samples"
    __table_args__ = (
        CheckConstraint(
            "status != 'active' OR (box_id IS NOT NULL AND position IS NOT NULL)",
            name="ck_samples_active_requires_location",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    environ_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    origin_id: Mapped[str | None] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(String(255))
    type: Mapped[str] = mapped_column(String(100), nullable=False)
    type_other: Mapped[str | None] = mapped_column(String(255))
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    passage: Mapped[int | None] = mapped_column(Integer)
    is_core: Mapped[bool] = mapped_column(Boolean, nullable=False)
    date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[SampleStatus] = mapped_column(
        Enum(SampleStatus, name="sample_status", values_callable=enum_values),
        default=SampleStatus.ACTIVE,
        nullable=False,
        server_default=SampleStatus.ACTIVE.value,
    )
    box_id: Mapped[int | None] = mapped_column(ForeignKey("boxes.id", ondelete="RESTRICT"))
    position: Mapped[str | None] = mapped_column(String(8))
    notes: Mapped[str | None] = mapped_column(Text)

    owner: Mapped[User] = relationship(back_populates="owned_samples", foreign_keys=[owner_id])
    box: Mapped[Box | None] = relationship(back_populates="samples")
    movements: Mapped[list["Movement"]] = relationship(back_populates="sample")


Index(
    "uq_samples_active_position",
    Sample.box_id,
    Sample.position,
    unique=True,
    postgresql_where=text("status = 'active'"),
)


class Movement(Base):
    __tablename__ = "movements"

    id: Mapped[int] = mapped_column(primary_key=True)
    sample_id: Mapped[int] = mapped_column(ForeignKey("samples.id", ondelete="RESTRICT"), nullable=False)
    action: Mapped[MovementAction] = mapped_column(
        Enum(MovementAction, name="movement_action", values_callable=enum_values), nullable=False
    )
    date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    operator_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    source_box_id: Mapped[int | None] = mapped_column(ForeignKey("boxes.id", ondelete="RESTRICT"))
    source_position: Mapped[str | None] = mapped_column(String(8))
    destination_box_id: Mapped[int | None] = mapped_column(ForeignKey("boxes.id", ondelete="RESTRICT"))
    destination_position: Mapped[str | None] = mapped_column(String(8))
    note: Mapped[str | None] = mapped_column(Text)

    sample: Mapped[Sample] = relationship(back_populates="movements")
    operator: Mapped[User] = relationship(back_populates="operated_movements")
    source_box: Mapped[Box | None] = relationship(foreign_keys=[source_box_id])
    destination_box: Mapped[Box | None] = relationship(foreign_keys=[destination_box_id])
