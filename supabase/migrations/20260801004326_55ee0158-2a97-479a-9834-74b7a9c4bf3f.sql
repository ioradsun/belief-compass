DROP POLICY IF EXISTS "market-media is service-role only" ON storage.objects;
CREATE POLICY "market-media is service-role only"
ON storage.objects
AS RESTRICTIVE
FOR ALL
TO anon, authenticated
USING (bucket_id <> 'market-media')
WITH CHECK (bucket_id <> 'market-media');