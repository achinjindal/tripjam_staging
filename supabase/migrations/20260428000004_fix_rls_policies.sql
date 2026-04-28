-- Fix RLS: add explicit INSERT/UPDATE/DELETE policies with WITH CHECK
-- The original USING-only policies may not cover INSERT properly

-- trip_todos
DROP POLICY IF EXISTS "Users can manage todos for their trips" ON trip_todos;
CREATE POLICY "Users can read todos for their trips" ON trip_todos
  FOR SELECT USING (
    trip_id IN (SELECT id FROM trips WHERE created_by = auth.uid())
    OR trip_id IN (SELECT trip_id FROM trip_members WHERE user_id = auth.uid())
  );
CREATE POLICY "Users can insert todos for their trips" ON trip_todos
  FOR INSERT WITH CHECK (
    trip_id IN (SELECT id FROM trips WHERE created_by = auth.uid())
    OR trip_id IN (SELECT trip_id FROM trip_members WHERE user_id = auth.uid())
  );
CREATE POLICY "Users can update todos for their trips" ON trip_todos
  FOR UPDATE USING (
    trip_id IN (SELECT id FROM trips WHERE created_by = auth.uid())
    OR trip_id IN (SELECT trip_id FROM trip_members WHERE user_id = auth.uid())
  );
CREATE POLICY "Users can delete todos for their trips" ON trip_todos
  FOR DELETE USING (
    trip_id IN (SELECT id FROM trips WHERE created_by = auth.uid())
    OR trip_id IN (SELECT trip_id FROM trip_members WHERE user_id = auth.uid())
  );

-- trip_bookmarks
DROP POLICY IF EXISTS "Users can manage bookmarks for their trips" ON trip_bookmarks;
CREATE POLICY "Users can read bookmarks for their trips" ON trip_bookmarks
  FOR SELECT USING (
    trip_id IN (SELECT id FROM trips WHERE created_by = auth.uid())
    OR trip_id IN (SELECT trip_id FROM trip_members WHERE user_id = auth.uid())
  );
CREATE POLICY "Users can insert bookmarks for their trips" ON trip_bookmarks
  FOR INSERT WITH CHECK (
    trip_id IN (SELECT id FROM trips WHERE created_by = auth.uid())
    OR trip_id IN (SELECT trip_id FROM trip_members WHERE user_id = auth.uid())
  );
CREATE POLICY "Users can update bookmarks for their trips" ON trip_bookmarks
  FOR UPDATE USING (
    trip_id IN (SELECT id FROM trips WHERE created_by = auth.uid())
    OR trip_id IN (SELECT trip_id FROM trip_members WHERE user_id = auth.uid())
  );
CREATE POLICY "Users can delete bookmarks for their trips" ON trip_bookmarks
  FOR DELETE USING (
    trip_id IN (SELECT id FROM trips WHERE created_by = auth.uid())
    OR trip_id IN (SELECT trip_id FROM trip_members WHERE user_id = auth.uid())
  );

-- trip_expenses
DROP POLICY IF EXISTS "Users can manage expenses for their trips" ON trip_expenses;
CREATE POLICY "Users can read expenses for their trips" ON trip_expenses
  FOR SELECT USING (
    trip_id IN (SELECT id FROM trips WHERE created_by = auth.uid())
    OR trip_id IN (SELECT trip_id FROM trip_members WHERE user_id = auth.uid())
  );
CREATE POLICY "Users can insert expenses for their trips" ON trip_expenses
  FOR INSERT WITH CHECK (
    trip_id IN (SELECT id FROM trips WHERE created_by = auth.uid())
    OR trip_id IN (SELECT trip_id FROM trip_members WHERE user_id = auth.uid())
  );
CREATE POLICY "Users can update expenses for their trips" ON trip_expenses
  FOR UPDATE USING (
    trip_id IN (SELECT id FROM trips WHERE created_by = auth.uid())
    OR trip_id IN (SELECT trip_id FROM trip_members WHERE user_id = auth.uid())
  );
CREATE POLICY "Users can delete expenses for their trips" ON trip_expenses
  FOR DELETE USING (
    trip_id IN (SELECT id FROM trips WHERE created_by = auth.uid())
    OR trip_id IN (SELECT trip_id FROM trip_members WHERE user_id = auth.uid())
  );
