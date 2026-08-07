-- RETIRE INVITATIONS AND SAY HI.
--
-- Both were person-to-person systems and Challenge replaced them with one
-- primitive, so their code is gone as of this change and these tables have no
-- reader and no writer left in the repository.
--
-- WHY DROP RATHER THAN LEAVE THEM SITTING. A table nobody reads is not free: it
-- is a shape the next person has to reason about, an entry in the generated
-- types, and a standing invitation to build the next feature on top of a system
-- that was deliberately abandoned. This codebase has already paid for
-- infrastructure that outlived its purpose — `user_events` sat with an INSERT
-- policy and zero writers for months, and `market_suggestions` still holds no
-- rows. Leaving two more of those behind would be choosing the same debt again.
--
-- WHAT IS ACTUALLY LOST, stated plainly rather than waved through:
--
--   `market_invites`        invitations sent through Launch Mode. Measured
--                           before this ran: zero rows. The feature reached
--                           production but no creator used it.
--   `welcomes`              every "Say Hi" ever sent.
--   `welcome_room_visits`   the per-wallet timestamps behind the daily room
--                           reset. Found by tracing what `markRoomSeen` actually
--                           wrote rather than by assuming Say Hi was one table —
--                           dropping only `welcomes` would have left this one
--                           orphaned and invisible.
--
-- Neither is reconstructible. Neither feeds a metric that survives this change:
-- check-launch became check-challenge and measures called → answered, which
-- these tables cannot express. If either turns out to be wanted, it comes back
-- as a fresh table with the shape the new feature needs, not as an archaeology
-- exercise against a schema built for a different product.
--
-- The functions are dropped with CASCADE because the triggers depend on them;
-- dropping a table does not remove a function that only it referenced, and a
-- validate trigger for a table that no longer exists is exactly the kind of
-- orphan that makes a schema hard to read a year later.

DROP TABLE IF EXISTS public.market_invites CASCADE;
DROP FUNCTION IF EXISTS public.market_invites_validate() CASCADE;

DROP TABLE IF EXISTS public.welcomes CASCADE;
DROP TABLE IF EXISTS public.welcome_room_visits CASCADE;
