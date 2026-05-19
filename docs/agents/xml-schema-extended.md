## FileMaker SaveAsXML

**Save a Copy as XML** (often shortened to _SaveAsXML_) is a function in Claris FileMaker for exporting an open FileMaker file as an XML document. The XML contains all schema and structural details of the FileMaker solution — tables, field definitions, layouts, scripts, value lists, security privileges, etc. — but does not include any record data from the tables. The XML file therefore serves as documentation of the application and lets developers track changes to the structure of the FileMaker file.

When the option "Include details for analysis tools" is selected, additional information is included in the XML schema.


## Extended XML structure

This is the high-level structure of the XML export produced from a FileMaker file.
The key difference is the `<DDR_INFO>` catalog, which contains information about calculations as a chunk list and about script steps in plain text.

To determine whether the extended entries are present, check the `Has_DDR_INFO="True"` attribute on the root element `<FMSaveAsXML>`.


```XML
<?xml version="1.0" encoding="utf-8"?>
<FMSaveAsXML version="2.2.3.0" Source="22.0.4" File="Prices.fmp12" UUID="0ED9DE59-5F50-4AC7-9559-523C13442ED5" locale="English" Has_DDR_INFO="True">
    <Structure membercount="2">
        <AddAction membercount="18">
            <BaseDirectoryCatalog membercount="1" generate="True" temporary="True">...</BaseDirectoryCatalog>
            <ExternalDataSourceCatalog membercount="4">...</ExternalDataSourceCatalog>
            <BaseTableCatalog membercount="5">...</BaseTableCatalog>
            <TableOccurrenceCatalog membercount="7">...</TableOccurrenceCatalog>
            <CustomFunctionsCatalog membercount="28">...</CustomFunctionsCatalog>
            <FieldsForTables membercount="5">...</FieldsForTables>
            <ValueListCatalog membercount="1">...</ValueListCatalog>
            <RelationshipCatalog membercount="3">...</RelationshipCatalog>
            <CalcsForCustomFunctions membercount="28">...</CalcsForCustomFunctions>
            <ScriptCatalog membercount="106">...</ScriptCatalog>
            <ThemeCatalog membercount="1">...</ThemeCatalog>
            <LayoutCatalog membercount="7">...</LayoutCatalog>
            <PrivilegeSetsCatalog membercount="6">...</PrivilegeSetsCatalog>
            <ExtendedPrivilegesCatalog membercount="9">...</ExtendedPrivilegesCatalog>
            <AccountsCatalog membercount="6">...</AccountsCatalog>
            <StepsForScripts membercount="82">...</StepsForScripts>
            <CustomMenuCatalog membercount="24">...</CustomMenuCatalog>
            <PasteIndexList membercount="0"></PasteIndexList>
        </AddAction>
        <ModifyAction membercount="2">
            <FieldsForTables membercount="42">...</FieldsForTables>
            <LayoutCatalog membercount="1">...</LayoutCatalog>
        </ModifyAction>
    </Structure>
    <Metadata membercount="1">
        <AddAction membercount="6">
            <Encryption type="0"></Encryption>
            <Minimum version="16.0" value="1600"></Minimum>
            <Login type="1">...</Login>
            <Defaults>...</Defaults>
            <Spelling underline="False"></Spelling>
            <ScriptTriggers membercount="1">...</ScriptTriggers>
        </AddAction>
    </Metadata>
	<DDR_INFO>
		<Calculation>
			<ObjectList>
				<_7AF3C07C-BDD6-4710-B81C-0FDBEF81858A_0 hash="027637D0F9A46FCD9BFCA8738C3FA47B" datatype="ChunkList">
					<TableOccurrenceReference id="1065089" name="Prices" UUID="7ED28AAE-2DA6-4357-B4F5-4821D4FE96F0"></TableOccurrenceReference>
					<ChunkList hash="027637D0F9A46FCD9BFCA8738C3FA47B">
						<Chunk type="FunctionRef">If</Chunk>
						<Chunk type="NoRef">( </Chunk>
						<Chunk type="FunctionRef">not</Chunk>
						<Chunk type="NoRef"> </Chunk>
						<Chunk type="FunctionRef">IsEmpty</Chunk>
						<Chunk type="NoRef">(</Chunk>
						<Chunk type="FieldRef">
							<FieldReference id="5" name="Supplier No" repetition="1" UUID="D550B213-FC57-4F53-A112-22259B0870B5">
								<TableOccurrenceReference id="1065089" name="Prices" UUID="7ED28AAE-2DA6-4357-B4F5-4821D4FE96F0"></TableOccurrenceReference>
							</FieldReference>
						</Chunk>
						<Chunk type="NoRef">);</Chunk>
						<Chunk type="FieldRef">
							<FieldReference id="2" name="Article No" repetition="1" UUID="D19C9476-B58D-405E-B8C7-876BB2684EB5">
								<TableOccurrenceReference id="1065089" name="Prices" UUID="7ED28AAE-2DA6-4357-B4F5-4821D4FE96F0"></TableOccurrenceReference>
							</FieldReference>
						</Chunk>
						<Chunk type="NoRef">;&quot;&quot;)</Chunk>
					</ChunkList>
				</_7AF3C07C-BDD6-4710-B81C-0FDBEF81858A_0>
                ...
            </ObjectList>
		</Calculation>
		<Script>
			<ObjectList>
				<_6A6C19D0-77D3-4E00-A18A-5A0DE39A59D6 hash="0A981E7C3F8DB44B097FDEF591767932" datatype="StepText">Perform Script [ “Filing: Close” ]</_6A6C19D0-77D3-4E00-A18A-5A0DE39A59D6>
				<_2F1D9460-94F9-45B6-A96B-43E06ABC1CAB hash="0FA1049AA7A69EEAB05D9C107CE4CFE5" datatype="StepText">Perform Script [ “Modules: Overview” from file: “MainMenu” ]</_2F1D9460-94F9-45B6-A96B-43E06ABC1CAB>
                ...
            </ObjectList>
		</Script>
	</DDR_INFO>
</FMSaveAsXML>
```
